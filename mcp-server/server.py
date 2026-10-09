"""Stdio only: launched by the authenticated API, never exposed as an unauthenticated HTTP service."""
import asyncio
import json
import os
from mcp.server.fastmcp import FastMCP
from backend.app.auth import authenticate_token
from backend.app.store import Store
from backend.app.config import settings
from backend.app.schemas import InventoryInput, Recipe, Evaluation
from pydantic import BaseModel

mcp = FastMCP('FridgeOut')
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


class RecipeToSave(BaseModel):
    recipe: Recipe
    evaluation: Evaluation


@mcp.tool()
async def save_recipes(recipes: list[RecipeToSave], session_id: str) -> str:
    if not 1 <= len(recipes) <= 5:
        raise ValueError('Save between one and five recipes')
    db = await store()
    if not await db.request('recipe_sessions', item_id=session_id):
        raise ValueError('Session does not belong to the authenticated user')
    rows = [{**item.recipe.model_dump(),
             'image_status': 'none' if settings().demo_mode else 'pending',
             'evaluation': item.evaluation.model_dump(),
             'evaluation_score': item.evaluation.overall_score, 'session_id': session_id}
            for item in recipes]
    return json.dumps(await db.request('recipe_drafts', 'POST', rows))


@mcp.tool()
async def get_favorite_recipes() -> str:
    return json.dumps(await (await store()).favorites())


if __name__ == '__main__':
    mcp.run(transport='stdio')
