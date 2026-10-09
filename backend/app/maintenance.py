"""Bounded housekeeping on API startup and every six hours; no extra paid worker."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
import httpx
from .config import settings
from .costs import admin
from .http_client import supabase_client
from .spool import trim_spool

log = logging.getLogger('fridgechef')


async def clean_storage(user_id=None):
    now = datetime.now(timezone.utc)
    params = {'select': '*', 'next_attempt_at': f'lte.{now.isoformat()}', 'limit': '100', 'order': 'next_attempt_at.asc'}
    if user_id:
        params['user_id'] = f'eq.{user_id}'
    rows = await admin('image_cleanup_queue', 'GET', params=params)
    cfg = settings()
    async with supabase_client() as client:
        for row in rows:
            path = row['path']
            # Validate even trusted queue entries before issuing an admin Storage deletion.
            if not path.startswith(str(row['user_id']) + '/') or '..' in path.split('/'):
                log.error('invalid_cleanup_path owner=%s', row['user_id'])
                await admin('image_cleanup_queue', 'DELETE', params={'path': f'eq.{path}'})
                continue
            try:
                # Do not delete an image that a retained recipe still references.
                referenced = await admin('recipes', 'GET', params={'image_path': f'eq.{path}', 'select': 'id', 'limit': '1'})
                if referenced:
                    await admin('image_cleanup_queue', 'DELETE', params={'path': f'eq.{path}'})
                    continue
                response = await client.request('DELETE', cfg.supabase_url + '/storage/v1/object/recipe-images',
                    json={'prefixes': [path, path + '.thumb.jpg']}, headers={
                        'apikey': cfg.supabase_service_role_key,
                        'Authorization': 'Bearer ' + cfg.supabase_service_role_key})
                response.raise_for_status()
                await admin('image_cleanup_queue', 'DELETE', params={'path': f'eq.{path}'})
            except Exception as exc:
                # Persist retry state, avoiding a busy loop during an outage.
                attempts = row['attempts'] + 1
                due = now + timedelta(minutes=min(1440, 5 * 2 ** min(attempts, 8)))
                await admin('image_cleanup_queue', 'PATCH', {'attempts': attempts,
                    'next_attempt_at': due.isoformat()}, {'path': f'eq.{path}'})
                log.warning('image_cleanup_deferred owner=%s error_type=%s', row['user_id'], type(exc).__name__)


async def run_once():
    if settings().demo_mode or not settings().supabase_service_role_key:
        return
    summary = await admin('rpc/prune_app_data', data={
        'batch_size': 100})
    await clean_storage()
    await asyncio.to_thread(trim_spool)
    log.info('maintenance_complete removed=%s', summary)


async def maintenance_loop():
    while True:
        try:
            await run_once()
        except Exception as exc:
            log.warning('maintenance_failed error_type=%s', type(exc).__name__)
        await asyncio.sleep(6 * 60 * 60)


async def clean_user_images(user):
    if settings().demo_mode or not settings().supabase_service_role_key:
        return
    try:
        await clean_storage(user.user_id)
    except Exception as exc:
        log.warning('user_image_cleanup_deferred user_id=%s error_type=%s', user.user_id, type(exc).__name__)
