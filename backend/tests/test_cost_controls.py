from uuid import uuid4
import pytest
from fastapi import HTTPException
from backend.app import costs
from backend.app.auth import Identity
from backend.app.config import settings


@pytest.fixture
def accounting(monkeypatch):
    monkeypatch.setenv('DEMO_MODE', 'false')
    settings.cache_clear()
    jobs = {}
    calls = []
    async def admin(path, method='POST', data=None, params=None):
        calls.append((path, method, data))
        if path.startswith('rpc/'):
            key = data['owner_id'], data['job_id']
            if key in jobs:
                job = jobs[key]
                if job['fingerprint'] != data['fingerprint'] or job['kind'] != data['job_kind']:
                    return {'state': 'conflict'}
                return {'state': job['status'], 'result': job.get('result')}
            jobs[key] = {'status': 'running', 'kind': data['job_kind'], 'fingerprint': data['fingerprint']}
            return {'state': 'reserved', 'free_operation_id': data['included_operation_id'] or data['job_id']}
        key = params['user_id'][3:], params['id'][3:]
        jobs[key].update(data)
        return [jobs[key]]
    monkeypatch.setattr(costs, 'admin', admin)
    yield calls, jobs
    settings.cache_clear()


@pytest.mark.asyncio
async def test_completed_job_replays_without_provider_work_and_scopes_owner(accounting):
    count = 0
    async def work():
        nonlocal count
        count += 1
        return {'recipes': []}
    job = uuid4()
    user = Identity(str(uuid4()), 'jwt')
    assert await costs.run_paid(user, 'generate', job, {}, work) == {'recipes': [], 'free_operation_id': str(job)}
    assert await costs.run_paid(user, 'generate', job, {}, work) == {'recipes': [], 'free_operation_id': str(job)}
    assert count == 1
    await costs.run_paid(Identity(str(uuid4()), 'other'), 'generate', job, {}, work)
    assert count == 2
    with pytest.raises(HTTPException) as error:
        await costs.run_paid(user, 'recognize', job, {'photo': 'changed'}, work)
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_failure_is_not_released_or_repeated(accounting):
    count = 0
    async def fail():
        nonlocal count
        count += 1
        raise TimeoutError('May already be billed')
    job, user = uuid4(), Identity(str(uuid4()), 'jwt')
    with pytest.raises(TimeoutError):
        await costs.run_paid(user, 'generate', job, {}, fail)
    with pytest.raises(HTTPException):
        await costs.run_paid(user, 'generate', job, {}, fail)
    assert count == 1
    assert next(iter(accounting[1].values()))['status'] == 'failed'


@pytest.mark.asyncio
@pytest.mark.parametrize('state', ['running','failed','conflict','free_limit','operation_required','operation_used','daily_limit','rate_limit','image_limit','busy'])
async def test_denied_reservation_never_calls_provider(accounting,monkeypatch,state):
    async def denied(*args,**kwargs): return {'state':state}
    async def unexpected(): raise AssertionError('Must not spend on denied reservation')
    monkeypatch.setattr(costs,'admin',denied)
    with pytest.raises(HTTPException):
        await costs.run_paid(Identity(str(uuid4()),'jwt'),'generate',uuid4(),{},unexpected)


@pytest.mark.asyncio
async def test_missing_accounting_key_fails_closed(monkeypatch):
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY','')
    settings.cache_clear()
    try:
        with pytest.raises(HTTPException) as error:
            await costs.admin('rpc/reserve_free_ai_job',data={})
        assert error.value.status_code==503
    finally:
        settings.cache_clear()
