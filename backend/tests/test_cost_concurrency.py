"""Real concurrent reservation transactions. Requires a disposable migrated DB."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import json
import os
import subprocess
from threading import Barrier
from uuid import uuid4
import pytest

URL = os.environ.get('TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Needs disposable PostgreSQL database')


def sql(query):
    result = subprocess.run(['psql', URL, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', query],
                            capture_output=True, text=True, check=True)
    return result.stdout.strip()


def reserve(owner, budget, daily, barrier):
    barrier.wait()
    result = sql(f"begin; set local role service_role; select reserve_free_ai_job('{owner}','{uuid4()}',"
                 f"'generate','race',.1,3,{budget},{daily}); select pg_sleep(.1); commit;")
    return json.loads(next(line for line in result.splitlines() if line.startswith('{')))['state']


def test_concurrent_requests_cannot_exceed_user_quota():
    owner = uuid4()
    sql(f"insert into auth.users(id) values('{owner}')")
    barrier = Barrier(2)
    with ThreadPoolExecutor(2) as workers:
        results = list(workers.map(lambda _: reserve(owner, 1000, 1, barrier), range(2)))
    assert sorted(results) == ['free_limit', 'reserved']


def test_concurrent_users_cannot_exceed_global_budget():
    owners = [uuid4(), uuid4()]
    for owner in owners:
        sql(f"insert into auth.users(id) values('{owner}')")
    baseline = Decimal(sql("select coalesce(sum(reserved_usd),0) from ai_jobs where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'"))
    barrier = Barrier(2)
    with ThreadPoolExecutor(2) as workers:
        results = list(workers.map(lambda owner: reserve(owner, baseline + Decimal('.15'), 30, barrier), owners))
    assert sorted(results) == ['daily_limit', 'reserved']
