import asyncio
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from backend.app.config import settings
from backend.app.auth import Identity, authenticate_token
from backend.app.schemas import Recipe, Preferences, Ingredient, Evaluation
from backend.app.guardrails import validate_recipe, dietary_errors
from backend.app.graph import build_graph
from backend.app.store import Store


def sample_recipe(**changes):
    data = dict(recipe_name='Spinach eggs', ingredients=[{'name': 'egg', 'quantity': 2, 'unit': 'piece'},
        {'name': 'spinach', 'quantity': 1, 'unit': 'bag'}], pantry_staples=['salt'], cooking_time_minutes=15,
        dietary_tags=['vegetarian'], steps=['Beat egg and chop spinach.', 'Cook egg with spinach in a pan.'],
        reason='Uses your ingredients.')
    return Recipe(**(data | changes))


INVENTORY = [dict(food_name='egg', quantity=2, unit='piece'), dict(food_name='spinach', quantity=1, unit='bag')]


@pytest.fixture(autouse=True)
def local_mode(monkeypatch, tmp_path):
    monkeypatch.setenv('DEMO_MODE', 'true')
    monkeypatch.setenv('DEMO_DB_PATH', str(tmp_path / 'demo.sqlite3'))
    settings.cache_clear()
    yield
    settings.cache_clear()


def test_inventory_and_dietary_guards():
    assert not validate_recipe(sample_recipe(), INVENTORY, Preferences(vegetarian=True))
    assert validate_recipe(sample_recipe(), INVENTORY, Preferences(vegan=True))
    assert validate_recipe(sample_recipe(cooking_time_minutes=25), INVENTORY, Preferences(max_cooking_time=15))
    recipe = sample_recipe(ingredients=[Ingredient(name='tofu', quantity=1, unit='piece')])
    assert validate_recipe(recipe, INVENTORY, Preferences())
    assert validate_recipe(sample_recipe(pantry_staples=['butter']), INVENTORY, Preferences())
    assert validate_recipe(sample_recipe(steps=['Prepare egg and spinach.', 'Add chicken and fry.']), INVENTORY, Preferences())
    assert dietary_errors(['mystery sauce'], Preferences(vegan=True))
    assert dietary_errors(['rice'], Preferences(keto=True))
    assert dietary_errors(['cheese'], Preferences(dairy_free=True))


def test_quantities_and_units():
    recipe = sample_recipe(ingredients=[Ingredient(name='egg', quantity=3, unit='piece')])
    assert validate_recipe(recipe, INVENTORY, Preferences())
    recipe = sample_recipe(ingredients=[Ingredient(name='egg', quantity=1, unit='g')])
    assert validate_recipe(recipe, INVENTORY, Preferences())
    recipe = sample_recipe(ingredients=[Ingredient(name='egg', quantity=2, unit='piece')] * 2)
    assert validate_recipe(recipe, INVENTORY, Preferences())


@pytest.mark.asyncio
async def test_retry_bound_and_no_hallucination():
    calls = []
    async def tools(name):
        calls.append(name)
        return INVENTORY if name == 'get_inventory' else Preferences(vegan=True).model_dump()
    result = await build_graph(tools).ainvoke({})
    assert result['attempts'] == 3
    assert result['final_recipes'] == []
    assert calls == ['get_inventory', 'get_user_preferences']


@pytest.mark.asyncio
async def test_tool_failure_stops_generation():
    async def broken(name):
        raise RuntimeError('MCP unavailable')
    with pytest.raises(RuntimeError):
        await build_graph(broken).ainvoke({})


@pytest.mark.asyncio
async def test_auth_requires_configuration_or_verified_token():
    from fastapi import HTTPException
    assert (await authenticate_token('local-demo')).user_id.endswith('0001')
    with pytest.raises(HTTPException):
        await authenticate_token('invented-user-id')


def test_api_and_mcp_end_to_end():
    from backend.app.main import app
    with TestClient(app) as client:
        assert client.get('/inventory').status_code == 401
        headers = {'Authorization': 'Bearer local-demo'}
        assert client.get('/inventory', headers=headers).json() == []
        for item in INVENTORY:
            assert client.post('/inventory', headers=headers, json=item).status_code == 201
        assert client.post('/inventory', headers=headers, json={'user_id': 'other', **INVENTORY[0]}).status_code == 422
        prefs = Preferences(vegetarian=True).model_dump()
        assert client.put('/preferences', headers=headers, json=prefs).status_code == 200
        response = client.post('/recipes/generate', headers=headers)
        assert response.status_code == 200, response.text
        result = response.json()
        assert len(result['recipes']) == 3
        assert result['attempts'] == 1
        assert len(client.get('/recipes/history', headers=headers).json()) == 3
        item = client.get('/inventory', headers=headers).json()[0]
        assert client.patch(f"/inventory/{item['id']}", headers=headers, json={'consumed': True}).status_code == 200
        assert len(client.get('/inventory', headers=headers).json()) == 1
        assert client.patch(f"/inventory/{item['id']}", headers=headers, json={'food_name': None}).status_code == 422
        assert client.delete('/inventory/00000000-0000-0000-0000-000000000099', headers=headers).status_code == 404


@pytest.mark.asyncio
async def test_store_scopes_all_requests(monkeypatch):
    import httpx
    settings().demo_mode = False
    settings().supabase_url = 'https://example.supabase.co'
    settings().supabase_anon_key = 'public-key'
    requests = []
    async def fake_request(self, method, url, **kwargs):
        requests.append((method, kwargs))
        return httpx.Response(200, json=[], request=httpx.Request(method, url))
    monkeypatch.setattr(httpx.AsyncClient, 'request', fake_request)
    db = Store(Identity('trusted-user', 'verified-jwt'))
    await db.request('inventory_items')
    await db.request('inventory_items', 'POST', {'user_id': 'attacker', 'food_name': 'egg'})
    await db.request('inventory_items', 'PATCH', {'user_id': 'attacker'}, 'item-id')
    for method, kwargs in requests:
        assert kwargs['params']['user_id'] == 'eq.trusted-user'
        assert kwargs['headers']['Authorization'] == 'Bearer verified-jwt'
        if method != 'GET':
            assert kwargs['json']['user_id'] == 'trusted-user'


@pytest.mark.asyncio
async def test_evaluator_rejection_triggers_regeneration(monkeypatch):
    from backend.app import llm
    from backend.app.schemas import Candidates
    settings().demo_mode = False
    generations = 0
    async def generate(inventory, preferences, errors):
        nonlocal generations
        generations += 1
        if generations > 1:
            assert errors  # Feedback reaches regeneration.
        return Candidates(recipes=[sample_recipe(recipe_name=f'Meal {i}') for i in range(3)])
    async def evaluate(recipe, inventory, preferences):
        return Evaluation(inventory_utilization=1, dietary_fit=1, recipe_feasibility=.9,
            cooking_time_fit=1, instruction_quality=.9, overall_score=.5 if generations == 1 else .9)
    monkeypatch.setattr(llm, 'generate', generate)
    async def evaluate_many(recipes, inventory, preferences):
        return [await evaluate(r, inventory, preferences) for r in recipes]
    monkeypatch.setattr(llm, 'evaluate_many', evaluate_many)
    async def tools(name):
        return INVENTORY if name == 'get_inventory' else Preferences().model_dump()
    result = await build_graph(tools).ainvoke({})
    assert result['attempts'] == 2
    assert len(result['final_recipes']) == 3
    assert all(r['evaluation'].overall_score >= .75 for r in result['final_recipes'])


def test_history_reads_saved_rows_without_starting_mcp(monkeypatch):
    from backend.app import main
    db = Store(Identity('00000000-0000-0000-0000-000000000001', 'local-demo'))
    saved = asyncio.run(db.request('recipes', 'POST', {'recipe_name': 'Saved meal'}))[0]
    def unexpected_mcp(*args, **kwargs):
        raise AssertionError('History must not start an MCP subprocess')
    monkeypatch.setattr(main, 'tools_for', unexpected_mcp)
    with TestClient(main.app) as client:
        assert client.get('/recipes/history').status_code == 401
        response = client.get('/recipes/history', headers={'Authorization': 'Bearer local-demo'})
        assert response.status_code == 200
        assert response.json()[0]['id'] == saved['id']



def test_history_keeps_only_latest_ten_and_permanently_deletes_older_recipes():
    from backend.app.main import app
    db = Store(Identity('00000000-0000-0000-0000-000000000001', 'local-demo'))
    saved = [asyncio.run(db.request('recipes', 'POST', {'recipe_name': f'Meal {n}'}))[0]
             for n in range(12)]
    with TestClient(app) as client:
        response = client.get('/recipes/history', headers={'Authorization': 'Bearer local-demo'})
    assert response.status_code == 200
    assert [row['id'] for row in response.json()] == [row['id'] for row in reversed(saved[-10:])]
    assert len(asyncio.run(db.request('recipes'))) == 10


def test_delete_history_recipe_is_scoped_and_persistent():
    from backend.app.main import app
    from backend.app.auth import authenticated
    owner = Identity('00000000-0000-0000-0000-000000000001', 'local-demo')
    other = Identity('00000000-0000-0000-0000-000000000002', 'local-demo')
    saved = asyncio.run(Store(owner).request('recipes', 'POST', {'recipe_name': 'Saved meal'}))[0]
    with TestClient(app) as client:
        url = f"/recipes/{saved['id']}"
        assert client.delete(url).status_code == 401
        app.dependency_overrides[authenticated] = lambda: other
        try:
            assert client.delete(url).status_code == 404
        finally:
            app.dependency_overrides.pop(authenticated, None)
        headers = {'Authorization': 'Bearer local-demo'}
        assert len(client.get('/recipes/history', headers=headers).json()) == 1
        assert client.delete(url, headers=headers).status_code == 204
        assert client.get('/recipes/history', headers=headers).json() == []
        assert client.delete(url, headers=headers).status_code == 404


@pytest.mark.asyncio
async def test_batch_evaluation_runs_once_and_keeps_ranking(monkeypatch):
    from backend.app import llm
    from backend.app.schemas import Candidates
    settings().demo_mode = False
    batches = []
    async def generate(inventory, preferences, errors):
        return Candidates(recipes=[sample_recipe(recipe_name=f'Meal {i}') for i in range(5)])
    async def evaluate_many(recipes, inventory, preferences):
        batches.append(recipes)
        return [Evaluation(inventory_utilization=1, dietary_fit=1, recipe_feasibility=1,
            cooking_time_fit=1, instruction_quality=1, overall_score=.80+i*.04)
            for i, _ in enumerate(recipes)]
    monkeypatch.setattr(llm, 'generate', generate)
    monkeypatch.setattr(llm, 'evaluate_many', evaluate_many)
    async def tools(name):
        return INVENTORY if name == 'get_inventory' else Preferences().model_dump()
    result = await build_graph(tools).ainvoke({})
    assert len(batches) == 1 and len(batches[0]) == 5
    assert [r['recipe'].recipe_name for r in result['final_recipes']] == ['Meal 4', 'Meal 3', 'Meal 2']
