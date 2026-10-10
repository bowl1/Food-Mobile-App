"""Server-verified App Store subscriptions; client CustomerInfo is never trusted."""
from datetime import datetime, timezone
from uuid import UUID
import secrets
import httpx
from fastapi import HTTPException
from .config import settings
from .costs import admin
from .http_client import supabase_client


def instant(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timezone required')
    return result


def verified_period(data):
    cfg = settings()
    subscriber = data['subscriber']
    entitlement = subscriber.get('entitlements', {}).get(cfg.revenuecat_entitlement, {})
    product = entitlement.get('product_identifier')
    subscription = subscriber.get('subscriptions', {}).get(product, {})
    if product != cfg.ios_subscription_product_id or subscription.get('store') != 'app_store':
        return None
    if subscription.get('refunded_at') or subscription.get('ownership_type', 'PURCHASED') != 'PURCHASED':
        return None
    if subscription.get('is_sandbox') and not cfg.billing_allow_sandbox:
        return None
    start = instant(subscription['purchase_date'])
    end = instant(subscription['expires_date'])
    if not start <= datetime.now(timezone.utc) < end:
        return None
    if instant(entitlement['expires_date']) <= datetime.now(timezone.utc):
        return None
    transaction = str(subscription['store_transaction_id'])
    if not transaction or transaction == 'None':
        raise ValueError('Missing transaction')
    return {'transaction': transaction, 'product': product, 'start': start.isoformat(), 'end': end.isoformat()}


async def sync_subscription(user_id):
    cfg = settings()
    if not cfg.revenuecat_secret_key:
        raise HTTPException(503, 'Subscriptions are not configured yet.')
    try:
        async with supabase_client() as client:
            response = await client.get('https://api.revenuecat.com/v1/subscribers/' + str(UUID(user_id)),
                headers={'Authorization': 'Bearer ' + cfg.revenuecat_secret_key}, timeout=15)
            response.raise_for_status()
            data = response.json()
        period = verified_period(data)
        if period and data['subscriber'].get('original_app_user_id') != user_id:
            raise HTTPException(409, 'This purchase belongs to another app account. Sign in to the original account to restore it.')
        observed = datetime.fromtimestamp(data['request_date_ms'] / 1000, timezone.utc).isoformat()
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        raise HTTPException(503, 'Unable to verify your subscription. Please try again.') from None
    await admin('rpc/sync_ai_subscription', data={'owner_id': user_id,
        'observed_at': observed, 'transaction_id': period['transaction'] if period else None,
        'product_id': period['product'] if period else None,
        'period_start': period['start'] if period else None,
        'period_end': period['end'] if period else None,
        'allowance': cfg.subscription_monthly_uses})
    from .auth import Identity
    from .costs import trial_status
    return await trial_status(Identity(user_id, ''))


async def handle_webhook(payload, authorization):
    cfg = settings()
    if not cfg.revenuecat_webhook_secret or not secrets.compare_digest(
            authorization, 'Bearer ' + cfg.revenuecat_webhook_secret):
        raise HTTPException(401, 'Unauthorized webhook.')
    event = payload.get('event', {})
    if event.get('type') == 'TEST':
        return {'status': 'ok'}
    ids = [event.get('app_user_id'), *(event.get('transferred_from') or []),
           *(event.get('transferred_to') or [])]
    owners = set()
    for value in ids:
        try:
            owners.add(str(UUID(value)))
        except (ValueError, TypeError, AttributeError):
            continue
    for owner in owners:
        # Refetch authoritative status even for delayed or duplicate webhook events.
        await sync_subscription(owner)
    return {'status': 'ok'}
