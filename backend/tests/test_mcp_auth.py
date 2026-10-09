import asyncio
import importlib.util
from pathlib import Path

import pytest
from fastapi import HTTPException
from backend.app.auth import Identity


def load_server(monkeypatch, token):
    monkeypatch.setenv('FRIDGECHEF_USER_TOKEN', token)
    path = Path(__file__).resolve().parents[2] / 'mcp-server/server.py'
    spec = importlib.util.spec_from_file_location('mcp_auth_test_server', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_concurrent_tools_verify_once_and_requests_stay_isolated(monkeypatch):
    first = load_server(monkeypatch, 'token-a')
    second = load_server(monkeypatch, 'token-b')
    verified = []

    async def verify(token):
        verified.append(token)
        await asyncio.sleep(0)
        return Identity(f'user-{token}', token)

    monkeypatch.setattr(first, 'authenticate_token', verify)
    monkeypatch.setattr(second, 'authenticate_token', verify)
    stores = await asyncio.gather(*(first.store() for _ in range(5)))
    other = await second.store()
    assert verified == ['token-a', 'token-b']
    assert all(db is stores[0] for db in stores)
    assert stores[0].identity == Identity('user-token-a', 'token-a')
    assert other.identity == Identity('user-token-b', 'token-b')
    assert other is not stores[0]


@pytest.mark.asyncio
async def test_failed_verification_is_not_cached(monkeypatch):
    server = load_server(monkeypatch, 'invalid-token')
    calls = 0

    async def reject(token):
        nonlocal calls
        calls += 1
        raise HTTPException(401, 'Invalid token')

    monkeypatch.setattr(server, 'authenticate_token', reject)
    for _ in range(2):
        with pytest.raises(HTTPException) as error:
            await server.store()
        assert error.value.status_code == 401
    assert calls == 2
    assert server._request_store is None
