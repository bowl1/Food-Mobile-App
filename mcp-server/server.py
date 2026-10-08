"""Stdio only: launched by the authenticated API, never exposed as an unauthenticated HTTP service."""
import json
import os
from mcp.server.fastmcp import FastMCP
from backend.app.auth import authenticate_token
from backend.app.store import Store
from backend.app.schemas import InventoryInput, Recipe, Evaluation

mcp = FastMCP('FridgeChef')


async def store():
    return Store(await authenticate_token(os.environ.get('FRIDGECHEF_USER_TOKEN', '')))


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
        'evaluation': evaluation.model_dump(), 'evaluation_score': evaluation.overall_score, 'session_id': session_id}))


@mcp.tool()
async def get_recipe_history() -> str:
    return json.dumps(await (await store()).request('recipes'))


if __name__ == '__main__':
    mcp.run(transport='stdio')
