from contextlib import asynccontextmanager
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from backend.app import main, llm
from backend.app.auth import Identity, authenticated
from backend.app.config import settings
from backend.app.costs import active_job
from backend.app.schemas import Candidates, Preferences, Evaluation, Recipe
from backend.app.store import Store


def recipe(name):
    return Recipe(recipe_name=name, ingredients=[{'name': 'egg', 'quantity': 1, 'unit': 'piece'}],
        pantry_staples=[], cooking_time_minutes=10, dietary_tags=[],
        steps=['Beat egg.', 'Cook egg in a pan.'], reason='Uses egg.')


@pytest.mark.asyncio
@pytest.mark.parametrize('first_count,second_count', [(2, 3), (4, 5)])
async def test_qualified_batch_is_persisted_before_next_llm_round(monkeypatch, tmp_path, first_count, second_count):
    cfg = settings().model_copy(update={'demo_mode': False})
    monkeypatch.setattr(main, 'settings', lambda: cfg)
    from backend.app import graph
    monkeypatch.setattr(graph, 'settings', lambda: cfg)
    rounds = 0
    publications, writes = [], []
    sessions = []
    class DB:
        def __init__(self, user):
            pass
        async def request(self, table, method='GET', data=None, item_id=None):
            if table == 'recipe_sessions' and method == 'POST':
                sessions.append({'id': str(uuid4()), **data})
                return [sessions[-1]]
            return []
    monkeypatch.setattr(main, 'Store', DB)
    async def generate(*args):
        nonlocal rounds
        rounds += 1
        if rounds == 2:
            assert len(writes) == 1 and len(writes[0]) == first_count
            assert len(publications[0]['recipes']) == first_count
        names = [f'Round {rounds} recipe {i}' for i in range(first_count if rounds == 1 else second_count)]
        return Candidates(recipes=[recipe(name) for name in names])
    async def evaluate(recipes, *args):
        return [Evaluation(inventory_utilization=1, dietary_fit=1, recipe_feasibility=1,
            cooking_time_fit=1, instruction_quality=1, overall_score=.8 if rounds == 1 else .95) for _ in recipes]
    monkeypatch.setattr(llm, 'generate', generate)
    monkeypatch.setattr(llm, 'evaluate_many', evaluate)
    @asynccontextmanager
    async def tools(user):
        async def call(name, arguments=None):
            if name == 'get_inventory':
                return [{'food_name': 'egg', 'quantity': 5, 'unit': 'piece'}]
            if name == 'get_user_preferences':
                return Preferences().model_dump()
            assert name == 'save_recipes'
            rows = [{**row['recipe'], 'id': str(uuid4())} for row in arguments['recipes']]
            writes.append(rows)
            return rows
        yield call
    monkeypatch.setattr(main, 'tools_for', tools)
    async def admin(path, method, data, params):
        assert params['user_id'] == 'eq.owner'
        assert params['status'] == 'eq.running'
        publications.append(data['result'])
        return [{}]
    monkeypatch.setattr(main, 'admin', admin)
    async def forbidden_cleanup(*args):
        pytest.fail('Cleanup must not delay the generation response')
    monkeypatch.setattr(main, 'clean_user_images', forbidden_cleanup)
    token = active_job.set(('owner', 'job'))
    try:
        result = await main.generate_recipe_batch(Identity('owner', 'token'), 'run')
    finally:
        active_job.reset(token)
    assert len(result['recipes']) == 5
    assert [len(rows) for rows in writes] == [first_count, second_count]
    assert all(len(snapshot['recipes']) <= 5 for snapshot in publications)
    assert result['attempts'] == 2


def test_progress_reads_only_authenticated_owners_job(monkeypatch):
    seen = []
    async def admin(path, method, params):
        seen.append(params)
        return []
    monkeypatch.setattr(main, 'admin', admin)
    main.app.dependency_overrides[authenticated] = lambda: Identity('owner', 'token')
    try:
        with TestClient(main.app) as client:
            assert client.get(f'/recipes/generation/{uuid4()}').status_code == 404
    finally:
        main.app.dependency_overrides.pop(authenticated, None)
    assert seen[0]['user_id'] == 'eq.owner' and seen[0]['kind'] == 'eq.generate'


@pytest.mark.asyncio
async def test_bulk_demo_write_assigns_owner_to_every_row(monkeypatch, tmp_path):
    cfg = settings().model_copy(update={'demo_mode': True, 'demo_db_path': str(tmp_path / 'bulk.sqlite')})
    from backend.app import store
    monkeypatch.setattr(store, 'settings', lambda: cfg)
    db = Store(Identity('owner', 'local-demo'))
    rows = await db.request('recipe_drafts', 'POST', [
        {'recipe_name': 'One', 'user_id': 'intruder'}, {'recipe_name': 'Two'}])
    assert len(rows) == 2 and all(row['user_id'] == 'owner' for row in rows)
    assert len(await db.request('recipe_drafts')) == 2
