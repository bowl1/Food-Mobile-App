from contextlib import asynccontextmanager
import anyio
import asyncio
import base64
import logging
import time
from uuid import uuid4, UUID
from fastapi import FastAPI, Depends, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .auth import authenticated, Identity
from .config import settings
from .store import Store
from .schemas import InventoryInput, InventoryPatch, Preferences, ImageInput
from .mcp_client import tools_for
from .graph import build_graph
from . import llm
from .costs import run_paid, active_free_operation, trial_status
from .http_client import new_client, use_client
from .maintenance import maintenance_loop, clean_user_images

logging.basicConfig(level=logging.INFO)
log = logging.getLogger('fridgechef')


@asynccontextmanager
async def lifespan(app):
    async with new_client() as client:
        app.state.supabase_http = client
        async def housekeeping():
            with use_client(client):
                await maintenance_loop()
        maintenance = asyncio.create_task(housekeeping())
        try:
            yield
        finally:
            maintenance.cancel()
            await asyncio.gather(maintenance, return_exceptions=True)
            app.state.supabase_http = None


app = FastAPI(title='FridgeOut: Recipe Wizard API', version='1.0.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings().cors_origins.split(','),
                   expose_headers=['X-AI-Job-State'], allow_methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], allow_headers=['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Free-Operation'])


@app.middleware('http')
async def observe(request: Request, call_next):
    request_id = str(uuid4())
    request.state.request_id = request_id
    start = time.monotonic()
    client = getattr(request.app.state, 'supabase_http', None)
    with use_client(client):
        response = await call_next(request)
    response.headers['X-Request-ID'] = request_id
    log.info('request_id=%s method=%s path=%s status=%s latency_ms=%.0f', request_id,
             request.method, request.url.path, response.status_code, (time.monotonic() - start) * 1000)
    return response


@app.exception_handler(Exception)
async def unexpected(request, exc):
    log.error('request_id=%s error_type=%s', getattr(request.state, 'request_id', ''), type(exc).__name__)
    return JSONResponse(status_code=503, content={'detail': 'Service unavailable. Please try again.',
        'request_id': getattr(request.state, 'request_id', '')})


@app.get('/health')
async def health():
    return {'status': 'ok', 'mode': 'demo' if settings().demo_mode else 'live'}


@app.get('/inventory')
async def inventory(user: Identity = Depends(authenticated)):
    return await Store(user).inventory()


@app.post('/inventory', status_code=201)
async def add_inventory(item: InventoryInput, user: Identity = Depends(authenticated)):
    return (await Store(user).request('inventory_items', 'POST', item.model_dump()))[0]


@app.patch('/inventory/{item_id}')
async def edit_inventory(item_id: UUID, item: InventoryPatch, user: Identity = Depends(authenticated)):
    data = item.model_dump(exclude_unset=True)
    if any(value is None for value in data.values()):
        raise HTTPException(422, 'Inventory fields cannot be null.')
    rows = await Store(user).request('inventory_items', 'PATCH', data, str(item_id))
    if not rows:
        raise HTTPException(404, 'Item not found.')
    return rows[0]


@app.delete('/inventory/{item_id}', status_code=204)
async def delete_inventory(item_id: UUID, user: Identity = Depends(authenticated)):
    if not await Store(user).request('inventory_items', 'DELETE', item_id=str(item_id)):
        raise HTTPException(404, 'Item not found.')


@app.get('/preferences')
async def preferences(user: Identity = Depends(authenticated)):
    return await Store(user).preferences()


@app.put('/preferences')
async def save_preferences(prefs: Preferences, user: Identity = Depends(authenticated)):
    return await Store(user).set_preferences(prefs.model_dump())


@app.post('/vision/recognize')
async def recognize(image: ImageInput, user: Identity = Depends(authenticated),
                    idempotency_key: UUID | None = Header(default=None)):
    try:
        content = base64.b64decode(image.image_base64, validate=True)
    except ValueError:
        raise HTTPException(422, 'Invalid image encoding.')
    valid = ((image.mime_type == 'image/jpeg' and content.startswith(b'\xff\xd8\xff')) or
             (image.mime_type == 'image/png' and content.startswith(b'\x89PNG\r\n\x1a\n')) or
             (image.mime_type == 'image/webp' and content.startswith(b'RIFF') and content[8:12] == b'WEBP'))
    if not valid or len(content) > 10_000_000:
        raise HTTPException(422, 'Upload a JPEG, PNG or WebP image under 10 MB.')
    if settings().demo_mode:
        return {'foods': [dict(food_name=n, quantity=q, unit=u, source='image_recognition', confidence=c)
                for n, q, u, c in [('egg', 6, 'piece', .97), ('spinach', 1, 'bag', .89), ('mushroom', 200, 'g', .92)]],
                'demo': True}
    if not settings().openai_api_key:
        raise HTTPException(503, 'AI service is not configured.')
    async def work():
        return (await llm.recognize(image)).model_dump()
    return await run_paid(user, 'recognize', idempotency_key, image.model_dump(), work)


@app.post('/recipes/generate')
async def generate(request: Request, user: Identity = Depends(authenticated),
                   idempotency_key: UUID | None = Header(default=None),
                   x_free_operation: UUID | None = Header(default=None)):
    if not settings().demo_mode and not settings().openai_api_key:
        raise HTTPException(503, 'AI service is not configured.')
    return await run_paid(user, 'generate', idempotency_key, {},
                          lambda: generate_recipes(request, user), included_operation=x_free_operation)


async def generate_recipes(request, user):
    if not settings().demo_mode and not settings().openai_api_key:
        raise HTTPException(503, 'AI service is not configured.')
    run_id = str(uuid4())
    log.info('request_id=%s user_id=%s agent_run_id=%s model=%s', request.state.request_id,
             user.user_id, run_id, 'demo-fixtures' if settings().demo_mode else settings().openai_model)
    try:
        with anyio.fail_after(240):
            async with tools_for(user) as call:
                state = await build_graph(call).ainvoke({})
                db = Store(user)
                await db.request('recipe_drafts', 'DELETE')
                session = (await db.request('recipe_sessions', 'POST', {
                    'agent_run_id': run_id, 'attempts': state['attempts'],
                    'free_operation_id': active_free_operation.get(),
                    'status': 'complete' if state['final_recipes'] else 'no_match'}))[0]
                recipes = []
                for row in state['final_recipes']:
                    saved = await call('save_recipe', {'recipe': row['recipe'].model_dump(),
                        'evaluation': row['evaluation'].model_dump(), 'session_id': session['id']})
                    recipes.append(saved[0])
                if not recipes:
                    await db.request('recipe_sessions', 'DELETE', item_id=session['id'])
    except TimeoutError:
        raise HTTPException(504, 'Recipe generation timed out. Please try again.')
    await clean_user_images(user)
    return {'recipes': recipes, 'agent_run_id': run_id, 'attempts': state['attempts'],
            'demo': settings().demo_mode,
            'message': ('' if len(recipes) == 5 else f'Only {len(recipes)} recipes passed your ingredient and preference checks.') if recipes else 'Your confirmed inventory cannot currently produce a validated recipe for these preferences. Edit your inventory or preferences and try again.'}


@app.get('/ai/trial')
async def free_trial(user: Identity = Depends(authenticated)):
    return await trial_status(user)


@app.get('/recipes/favorites')
async def favorites(user: Identity = Depends(authenticated)):
    return await Store(user).favorites()


@app.post('/recipes/{recipe_id}/favorite')
async def save_favorite(recipe_id: UUID, user: Identity = Depends(authenticated)):
    rows = await Store(user).save_favorite(str(recipe_id))
    if not rows:
        raise HTTPException(404, 'Recipe not found or no longer available. Generate a new batch.')
    return rows[0]


@app.post('/recipes/{recipe_id}/image')
async def image_for_recipe(recipe_id: UUID, retry: bool = False, user: Identity = Depends(authenticated)):
    from .recipe_images import recipe_image
    return await recipe_image(recipe_id, user, retry)


@app.delete('/recipes/favorites/{recipe_id}', status_code=204)
async def delete_recipe(recipe_id: UUID, user: Identity = Depends(authenticated)):
    rows = await Store(user).request('favorite_recipes', 'DELETE', item_id=str(recipe_id))
    if not rows:
        raise HTTPException(404, 'Recipe not found.')
    if not settings().demo_mode and rows[0].get('image_path'):
        from .recipe_images import remove_image
        await remove_image(user, rows[0]['image_path'])
    await clean_user_images(user)
