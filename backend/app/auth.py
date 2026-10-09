from dataclasses import dataclass
import httpx
from fastapi import Header, HTTPException
from .config import settings
from .http_client import supabase_client


@dataclass(frozen=True)
class Identity:
    user_id: str
    token: str


async def authenticate_token(token: str) -> Identity:
    cfg = settings()
    if cfg.demo_mode and token == 'local-demo':
        return Identity('00000000-0000-0000-0000-000000000001', token)
    if not cfg.supabase_url or not cfg.supabase_anon_key:
        raise HTTPException(503, 'Supabase is not configured.')
    async with supabase_client() as client:
        try:
            response = await client.get(f'{cfg.supabase_url}/auth/v1/user', timeout=15, headers={
                'apikey': cfg.supabase_anon_key, 'Authorization': f'Bearer {token}'})
        except httpx.HTTPError:
            raise HTTPException(503, 'Authentication service unavailable.')
    if response.status_code != 200:
        raise HTTPException(401, 'Your session expired. Please sign in again.')
    return Identity(response.json()['id'], token)


async def authenticated(authorization: str = Header(default='')) -> Identity:
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Please sign in.')
    return await authenticate_token(authorization[7:])
