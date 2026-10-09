import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from backend.app.auth import Identity
from backend.app.config import settings
from backend.app import recipe_images as images


@pytest.fixture
def image_backend(monkeypatch, tmp_path):
    monkeypatch.setenv('DEMO_MODE', 'false')
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key')
    monkeypatch.setenv('IMAGE_SPOOL_DIR', str(tmp_path / 'spool'))
    settings.cache_clear()
    from io import BytesIO
    from PIL import Image
    jpeg = BytesIO()
    Image.new('RGB', (1024, 1024), '#f5ae43').save(jpeg, format='JPEG')
    content = jpeg.getvalue()
    row = {'id': str(uuid4()), 'image_status': 'pending', 'recipe_name': 'Spinach eggs',
           'ingredients': [{'name': 'egg', 'quantity': 2, 'unit': 'piece'}],
           'pantry_staples': [], 'steps': ['Beat eggs.', 'Cook eggs.']}
    calls = []
    class DB:
        def __init__(self, user): self.user = user
        async def request(self, table, method='GET', data=None, item_id=None, filters=None):
            assert item_id == row['id']
            if self.user.user_id != 'owner': return []
            if method == 'PATCH':
                assert filters == {'image_lease_id': f"eq.{row['image_lease_id']}"}
                row.update(data)
            return [dict(row)]
    async def cloud(user, path, body=None, content=None):
        calls.append(path)
        if '/rpc/' in path:
            if row['image_status'] == 'generating': return []
            row.update(image_status='generating', image_lease_id=body['lease_id'], image_path=row.get('image_path', f"{user.user_id}/{row['id']}/image.jpg"))
            return [dict(row)]
        if '/sign/' in path: return {'signedURL': '/object/sign/recipe-images/example?token=short-lived'}
        assert content.startswith(b'\xff\xd8\xff')
        return {}
    async def paid(user, kind, job_id, payload, action):
        return await action()
    async def uploaded(user, path): return None
    monkeypatch.setattr(images, 'run_paid', paid)
    monkeypatch.setattr(images, 'uploaded_image', uploaded)
    row['_test_content'] = content
    monkeypatch.setattr(images, 'Store', DB)
    monkeypatch.setattr(images, 'cloud', cloud)
    yield row, calls, Identity('owner', 'user-jwt')
    settings.cache_clear()


@pytest.mark.asyncio
async def test_concurrent_requests_generate_once_and_reuse_saved_image(image_backend, monkeypatch):
    row, calls, user = image_backend
    generations = 0
    async def generate(recipe):
        nonlocal generations
        generations += 1
        await asyncio.sleep(.01)
        return row['_test_content']
    monkeypatch.setattr(images, 'generate_image', generate)
    results = await asyncio.gather(*(images.recipe_image(row['id'], user) for _ in range(3)))
    assert generations == 1
    assert sum(r['status'] == 'ready' for r in results) == 1
    assert row['image_status'] == 'ready'
    assert (await images.recipe_image(row['id'], user))['status'] == 'ready'
    assert generations == 1
    assert sum('/object/recipe-images/' in p for p in calls) == 2


@pytest.mark.asyncio
async def test_other_user_cannot_generate_or_read_image(image_backend):
    row, calls, _ = image_backend
    with pytest.raises(HTTPException) as error:
        await images.recipe_image(row['id'], Identity('someone-else', 'other-jwt'))
    assert error.value.status_code == 404
    assert calls == []


@pytest.mark.asyncio
async def test_failure_requires_explicit_retry(image_backend, monkeypatch):
    row, calls, user = image_backend
    async def broken(recipe): raise RuntimeError('Provider unavailable')
    monkeypatch.setattr(images, 'generate_image', broken)
    assert await images.recipe_image(row['id'], user) == {'status': 'failed'}
    assert row['image_status'] == 'failed'
    count = len(calls)
    assert await images.recipe_image(row['id'], user) == {'status': 'failed'}
    assert len(calls) == count
    async def works(recipe): return row['_test_content']
    monkeypatch.setattr(images, 'generate_image', works)
    assert (await images.recipe_image(row['id'], user, retry=True))['status'] == 'ready'


@pytest.mark.asyncio
async def test_image_api_requires_auth_and_demo_does_not_call_provider(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.store import Store
    monkeypatch.setenv('DEMO_MODE', 'true')
    monkeypatch.setenv('DEMO_DB_PATH', str(tmp_path / 'demo.sqlite3'))
    settings.cache_clear()
    saved = (await Store(Identity('00000000-0000-0000-0000-000000000001', 'local-demo')).request(
        'recipes', 'POST', {'recipe_name': 'Demo'}))[0]
    def unexpected(*args, **kwargs): raise AssertionError('No demo image billing')
    monkeypatch.setattr(images, 'generate_image', unexpected)
    with TestClient(app) as client:
        assert client.post(f"/recipes/{saved['id']}/image").status_code == 401
        response = client.post(f"/recipes/{saved['id']}/image", headers={'Authorization': 'Bearer local-demo'})
        assert response.json() == {'status': 'unavailable'}
    settings.cache_clear()


@pytest.mark.asyncio
async def test_image_prompt_uses_recipe_and_returns_jpeg(monkeypatch):
    import base64
    captured = {}
    async def generate(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(b'\xff\xd8\xffjpeg').decode())])
    class Client:
        def __init__(self, **kwargs): self.images = SimpleNamespace(generate=generate)
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    monkeypatch.setattr(images, 'AsyncOpenAI', Client)
    recipe = {'recipe_name': 'Spinach eggs', 'ingredients': [{'name': 'egg'}], 'pantry_staples': [], 'steps': ['Cook eggs.']}
    assert (await images.generate_image(recipe)).startswith(b'\xff\xd8\xff')
    assert captured['model'] == settings().openai_image_model
    assert captured['quality'] == 'low'
    assert captured['size'] == '1024x1024'
    assert captured['output_format'] == 'jpeg'
    assert 'Spinach eggs' in captured['prompt'] and 'Cook eggs.' in captured['prompt']


@pytest.mark.asyncio
async def test_image_cleanup_uses_owner_jwt_and_rejects_foreign_paths(monkeypatch):
    import httpx
    requests = []
    async def request(self, method, url, **kwargs):
        requests.append((method, url, kwargs))
        return httpx.Response(200, json=[], request=httpx.Request(method, url))
    monkeypatch.setattr(httpx.AsyncClient, 'request', request)
    user = Identity('owner', 'owner-token')
    await images.remove_image(user, 'other/recipe/image.jpg')
    assert requests == []
    await images.remove_image(user, 'owner/recipe/image.jpg')
    assert requests[0][0] == 'DELETE'
    assert requests[0][2]['json'] == {'prefixes': ['owner/recipe/image.jpg', 'owner/recipe/image.jpg.thumb.jpg']}
    assert requests[0][2]['headers']['Authorization'] == 'Bearer owner-token'


@pytest.mark.asyncio
async def test_upload_failure_recovers_spooled_output_without_another_model_call(image_backend, monkeypatch):
    import httpx
    row, calls, user = image_backend
    generations = 0
    async def generate(recipe):
        nonlocal generations
        generations += 1
        return row['_test_content']
    original = images.cloud
    async def failed_upload(user, path, body=None, content=None):
        if '/object/recipe-images/' in path:
            raise httpx.ConnectError('Storage down')
        return await original(user, path, body, content)
    monkeypatch.setattr(images, 'generate_image', generate)
    monkeypatch.setattr(images, 'cloud', failed_upload)
    assert await images.recipe_image(row['id'], user) == {'status': 'failed'}
    assert images.spool_file(user, row['image_path']).exists()
    monkeypatch.setattr(images, 'cloud', original)
    assert (await images.recipe_image(row['id'], user, retry=True))['status'] == 'ready'
    assert generations == 1
    assert not images.spool_file(user, row['image_path']).exists()


@pytest.mark.asyncio
async def test_uploaded_output_is_recovered_after_process_restart(image_backend, monkeypatch):
    row, calls, user = image_backend
    row['image_status'] = 'failed'
    async def uploaded(user, path): return row['_test_content']
    async def unexpected(recipe): raise AssertionError('Already paid image must be reused')
    monkeypatch.setattr(images, 'uploaded_image', uploaded)
    monkeypatch.setattr(images, 'generate_image', unexpected)
    assert (await images.recipe_image(row['id'], user, retry=True))['status'] == 'ready'


def test_thumbnail_is_smaller_and_preserves_original():
    from io import BytesIO
    from PIL import Image
    source = BytesIO()
    Image.new('RGB', (1024,1024), '#e38229').save(source, format='JPEG')
    original = source.getvalue()
    preview = images.thumbnail(original)
    assert len(preview) < len(original)
    assert Image.open(BytesIO(preview)).size == (360,360)
    assert Image.open(BytesIO(original)).size == (1024,1024)
