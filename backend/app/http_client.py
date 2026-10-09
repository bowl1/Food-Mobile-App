"""Reuse connections within the API lifecycle; credentials remain per request."""
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
import httpx

_current: ContextVar[httpx.AsyncClient | None] = ContextVar('supabase_http_client', default=None)


def new_client():
    return httpx.AsyncClient(timeout=20, limits=httpx.Limits(
        max_connections=50, max_keepalive_connections=20, keepalive_expiry=60))


@contextmanager
def use_client(client):
    token = _current.set(client)
    try:
        yield
    finally:
        _current.reset(token)


@asynccontextmanager
async def supabase_client():
    client = _current.get()
    if client is not None:
        yield client
    else:
        # Standalone MCP/tests have no API lifespan. Close their scoped client.
        async with new_client() as client:
            yield client
