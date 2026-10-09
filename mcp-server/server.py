"""Stdio only: launched by the authenticated API, never exposed as an unauthenticated HTTP service."""
import asyncio
import json
import os
from mcp.server.fastmcp import FastMCP
from backend.app.auth import authenticate_token
from backend.app.store import Store
from backend.app.config import settings
from backend.app.schemas import InventoryInput, Recipe, Evaluation

mcp = FastMCP('FridgeChef')
# Each API request owns a dedicated subprocess with one immutable bearer token.
_request_token = os.environ.get('FRIDGECHEF_USER_TOKEN', '')
_request_store: Store | None = None
_auth_lock = asyncio.Lock()


async def store():
    global _request_store
    async with _auth_lock:
        if _request_store is None:
            # Cache only successful verification; concurrent tools share the result.
            _request_store = Store(await authenticate_token(_request_token))
        return _request_store


@mcp.tool()
async def get_inventory() -> str:
    return json.dumps(await (await store()).inventory())


@mcp.tool()
async def get_user_preferences() -> str:
    return json.dumps(await (await store()).preferences())


@mcp.tool()
async def update_inventory(item: InventoryInput) -> str:
    # Explicit add tool. Recipe graph never calls inventory mutations.
    return json.dumps(await (await store()).request('inventory_items', 'POST', item.model_dump()))


@mcp.tool()
async def save_recipe(recipe: Recipe, evaluation: Evaluation, session_id: str) -> str:
    db = await store()
    if not await db.request('recipe_sessions', item_id=session_id):
        raise ValueError('Session does not belong to the authenticated user')
    return json.dumps(await db.request('recipes', 'POST', {**recipe.model_dump(),
        'image_status': 'none' if settings().demo_mode else 'pending',
        'evaluation': evaluation.model_dump(), 'evaluation_score': evaluation.overall_score, 'session_id': session_id}))


@mcp.tool()
async def get_recipe_history() -> str:
    rows = await (await store()).request('recipes', filters={'limit': '10'})
    return json.dumps(rows[:10])


if __name__ == '__main__':
    mcp.run(transport='stdio')
