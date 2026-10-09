import httpx
from fastapi.testclient import TestClient
from backend.app import main
from backend.app.config import settings


def test_api_reuses_client_but_verifies_each_users_token(monkeypatch):
    monkeypatch.setenv('DEMO_MODE', 'false')
    monkeypatch.setenv('SUPABASE_URL', 'https://supabase.test')
    monkeypatch.setenv('SUPABASE_ANON_KEY', 'test-anon')
    settings.cache_clear()
    clients, calls = [], []

    def respond(request):
        token = request.headers['authorization']
        calls.append((request.url.path, token))
        owner = {'Bearer token-a': 'user-a', 'Bearer token-b': 'user-b'}[token]
        if request.url.path == '/auth/v1/user':
            return httpx.Response(200, json={'id': owner})
        assert request.url.params['user_id'] == f'eq.{owner}'
        return httpx.Response(200, json=[{'id': owner, 'consumed': False}])

    def create():
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        clients.append(client)
        return client

    monkeypatch.setattr(main, 'new_client', create)
    try:
        with TestClient(main.app) as api:
            for token, owner in [('token-a', 'user-a'), ('token-b', 'user-b'), ('token-a', 'user-a')]:
                response = api.get('/inventory', headers={'Authorization': f'Bearer {token}'})
                assert response.status_code == 200
                assert response.json()[0]['id'] == owner
            assert len(clients) == 1
            assert not clients[0].is_closed
        assert clients[0].is_closed
        assert sum(path == '/auth/v1/user' for path, _ in calls) == 3
    finally:
        settings.cache_clear()
