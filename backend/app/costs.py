"""Persistent reservations and idempotency; only this module uses the admin key.
Reservation budgets are conservative estimates, not provider-enforced USD caps.
Failed calls retain reservations because provider work may already be billable.
"""
from contextvars import ContextVar
from hashlib import sha256
import json
from fastapi import HTTPException
import anyio
import httpx
from .config import settings
from .http_client import supabase_client
from . import tracing, monitoring

active_job = ContextVar('active_ai_job', default=None)
active_free_operation = ContextVar('active_free_operation', default=None)


async def admin(path, method='POST', data=None, params=None):
    cfg = settings()
    if not cfg.supabase_service_role_key:
        raise HTTPException(503, 'AI cost controls are not configured.')
    async with supabase_client() as client:
        try:
            response = await client.request(method, cfg.supabase_url + '/rest/v1/' + path,
                json=data, params=params, headers={'apikey': cfg.supabase_service_role_key,
                'Authorization': 'Bearer ' + cfg.supabase_service_role_key,
                'Prefer': 'return=representation'})
            response.raise_for_status()
            return response.json() if response.content else []
        except httpx.HTTPError:
            raise HTTPException(503, 'AI accounting unavailable. Check your recipes before retrying.') from None


async def run_paid(user, kind, job_id, payload, action, included_operation=None):
    if settings().demo_mode:
        return await action()
    cfg = settings()
    if job_id is None:
        raise HTTPException(422, 'An Idempotency-Key UUID is required for AI operations.')
    job_id = str(job_id)
    fingerprint = sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    result = await admin('rpc/reserve_free_ai_job', data={
        'owner_id': user.user_id, 'job_id': job_id, 'job_kind': kind, 'fingerprint': fingerprint,
        'cost_usd': getattr(cfg, f'ai_{kind}_reserve_usd'),
        'total_operations': cfg.free_trial_uses,
        'included_operation_id': str(included_operation) if included_operation else None,
        'recipe_id': payload.get('recipe_id') if kind == 'image' else None,
        'minute_limit': 6 if kind == 'image' else 3,
        'daily_budget': cfg.ai_daily_budget_usd})
    state = result['state']
    if state == 'complete':
        return result['result']
    messages = {'conflict': 'This request ID was already used for different input.',
        'running': 'This operation is still running. Retry the same request shortly.',
        'failed': 'This operation did not finish. Start a new operation to try again.',
        'busy': 'An AI operation is already running. Please wait.',
        'image_limit': 'This recipe has reached its image generation attempt limit.',
        'free_limit': 'You have used all 3 free tries. Free uses do not reset.',
        'operation_required': 'Generate a recipe using a free try to include its AI images.',
        'operation_used': 'This scan’s included recipe generation has already been used.',
        'rate_limit': 'Too many AI requests. Please wait a minute.',
        'daily_limit': 'Today’s AI service budget has been reached. Please try tomorrow.'}
    if state != 'reserved':
        raise HTTPException(409 if state in ('conflict','running','failed','busy','operation_required','operation_used') else 429,
                            messages.get(state, 'AI operation unavailable.'),
                            headers={'X-AI-Job-State': state, 'Retry-After': '10' if state in ('running','busy') else '60'})
    token = active_job.set((user.user_id, job_id))
    operation_token = active_free_operation.set(result['free_operation_id'])
    params = {'user_id': f'eq.{user.user_id}', 'id': f'eq.{job_id}', 'status': 'eq.running'}
    try:
        with tracing.identity(user.user_id, result['free_operation_id']), tracing.trace(
                'ai.' + kind, metadata={'job_id': job_id, 'request_id': monitoring.request_id.get()}):
            value = await action()
        if isinstance(value, dict):
            value = {**value, 'free_operation_id': result['free_operation_id']}
        if not await admin('ai_jobs', 'PATCH', {'status': 'complete', 'result': value}, params):
            raise HTTPException(503, 'Operation expired. Check your recipes before starting another.')
        return value
    except BaseException as exc:
        # Shield accounting from cancellation; never silently release paid reservations.
        with anyio.CancelScope(shield=True):
            try:
                await admin('ai_jobs', 'PATCH', {'status': 'failed'}, params)
            except HTTPException:
                pass  # Stale reservation fails closed on the next lookup.
        if isinstance(exc, HTTPException):
            exc.headers = {**(exc.headers or {}), 'X-AI-Job-State': 'failed'}
        raise
    finally:
        active_free_operation.reset(operation_token)
        active_job.reset(token)


async def trial_status(user):
    cfg = settings()
    if cfg.demo_mode:
        return {'total_uses': cfg.free_trial_uses, 'remaining_uses': cfg.free_trial_uses,
                'exhausted': False, 'demo': True}
    return await admin('rpc/free_trial_status', data={'owner_id': user.user_id,
        'total_operations': cfg.free_trial_uses})
