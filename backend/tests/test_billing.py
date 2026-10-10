from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
import httpx
import pytest
from fastapi import HTTPException
from backend.app import billing
from backend.app.config import settings


def subscriber():
    now = datetime.now(timezone.utc)
    return {'request_date_ms': now.timestamp() * 1000, 'subscriber': {
        'entitlements': {'fridgeout_pro': {'product_identifier': 'fridgeout_pro_monthly',
                                          'expires_date': (now + timedelta(days=20)).isoformat()}},
        'subscriptions': {'fridgeout_pro_monthly': {
            'store': 'app_store', 'ownership_type': 'PURCHASED', 'is_sandbox': False,
            'store_transaction_id': 'apple-renewal-1', 'purchase_date': (now - timedelta(days=10)).isoformat(),
            'expires_date': (now + timedelta(days=20)).isoformat(), 'refunded_at': None}}}}


def test_valid_subscription_uses_store_period_and_accepts_cancel_until_expiry():
    data = subscriber()
    data['subscriber']['subscriptions']['fridgeout_pro_monthly']['unsubscribe_detected_at'] = datetime.now(timezone.utc).isoformat()
    period = billing.verified_period(data)
    assert period['transaction'] == 'apple-renewal-1'
    assert period['start'] == data['subscriber']['subscriptions']['fridgeout_pro_monthly']['purchase_date']


@pytest.mark.parametrize('field,value', [('store', 'promotional'), ('refunded_at', 'now'),
    ('ownership_type', 'FAMILY_SHARED'), ('expires_date', '2000-01-01T00:00:00Z')])
def test_untrusted_or_inactive_subscriptions_do_not_unlock(field, value):
    data = subscriber()
    data['subscriber']['subscriptions']['fridgeout_pro_monthly'][field] = value
    assert billing.verified_period(data) is None


def test_sandbox_requires_explicit_configuration(monkeypatch):
    cfg = settings().model_copy(update={'billing_allow_sandbox': False})
    monkeypatch.setattr(billing, 'settings', lambda: cfg)
    data = subscriber()
    data['subscriber']['subscriptions']['fridgeout_pro_monthly']['is_sandbox'] = True
    assert billing.verified_period(data) is None
    cfg.billing_allow_sandbox = True
    assert billing.verified_period(data) is not None


@pytest.mark.asyncio
async def test_webhook_requires_secret_and_rechecks_authoritative_status(monkeypatch):
    cfg = settings().model_copy(update={'revenuecat_webhook_secret': 'local-test'})
    monkeypatch.setattr(billing, 'settings', lambda: cfg)
    owners = []
    async def sync(owner): owners.append(owner)
    monkeypatch.setattr(billing, 'sync_subscription', sync)
    payload = {'event': {'app_user_id': '00000000-0000-0000-0000-000000000001', 'type': 'RENEWAL'}}
    with pytest.raises(HTTPException) as error:
        await billing.handle_webhook(payload, 'Bearer wrong')
    assert error.value.status_code == 401 and not owners
    await billing.handle_webhook(payload, 'Bearer local-test')
    assert owners == ['00000000-0000-0000-0000-000000000001']


@pytest.mark.asyncio
@pytest.mark.parametrize('scenario', ['valid', 'other_owner', 'provider_failure'])
async def test_sync_only_writes_authoritative_owned_purchase(monkeypatch, scenario):
    owner = '00000000-0000-0000-0000-000000000001'
    data = subscriber()
    data['subscriber']['original_app_user_id'] = owner if scenario != 'other_owner' else 'another-owner'
    cfg = settings().model_copy(update={'revenuecat_secret_key': 'test-server-key'})
    monkeypatch.setattr(billing, 'settings', lambda: cfg)
    def respond(request):
        assert request.url.path.endswith(owner)
        assert request.headers['Authorization'] == 'Bearer test-server-key'
        return httpx.Response(503 if scenario == 'provider_failure' else 200, json=data)
    @asynccontextmanager
    async def client():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as value:
            yield value
    monkeypatch.setattr(billing, 'supabase_client', client)
    writes = []
    async def admin(path, data): writes.append((path, data))
    monkeypatch.setattr(billing, 'admin', admin)
    from backend.app import costs
    async def status(identity): return {'subscribed': True}
    monkeypatch.setattr(costs, 'trial_status', status)
    if scenario == 'valid':
        assert await billing.sync_subscription(owner) == {'subscribed': True}
        assert writes[0][1]['owner_id'] == owner
        assert writes[0][1]['transaction_id'] == 'apple-renewal-1'
        assert writes[0][1]['allowance'] == 20
    else:
        with pytest.raises(HTTPException) as error:
            await billing.sync_subscription(owner)
        assert error.value.status_code == (409 if scenario == 'other_owner' else 503)
        assert not writes
