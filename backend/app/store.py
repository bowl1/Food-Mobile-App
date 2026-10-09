"""The user's bearer token reaches PostgREST; RLS remains active on every query."""
import json
import sqlite3
from uuid import uuid4
from datetime import datetime, timezone
import httpx
from fastapi import HTTPException
from .auth import Identity
from .config import settings
from .http_client import supabase_client
from .schemas import Preferences


class Store:
    def __init__(self, identity: Identity):
        self.identity = identity

    async def request(self, table, method='GET', data=None, item_id=None, filters=None):
        cfg = settings()
        if cfg.demo_mode and self.identity.token == 'local-demo':
            return self._local(table, method, data, item_id)
        params = {} if table.startswith('rpc/') else {'user_id': f'eq.{self.identity.user_id}', 'select': '*'}
        if item_id:
            params['id'] = f'eq.{item_id}'
        if table in ('recipes', 'recipe_drafts', 'favorite_recipes', 'recipe_sessions') and method == 'GET':
            params.update(order='created_at.desc,id.desc', limit='100')
        params.update(filters or {})
        payload = data
        if method in ('POST', 'PATCH') and not table.startswith('rpc/'):
            payload = ([{**row, 'user_id': self.identity.user_id} for row in data]
                       if isinstance(data, list) else {**(data or {}), 'user_id': self.identity.user_id})
        async with supabase_client() as client:
            try:
                response = await client.request(method, f'{cfg.supabase_url}/rest/v1/{table}',
                    params=params, json=payload, headers={
                        'apikey': cfg.supabase_anon_key,
                        'Authorization': f'Bearer {self.identity.token}',
                        'Prefer': 'return=representation'})
                response.raise_for_status()
            except httpx.HTTPError:
                raise HTTPException(503, 'Database unavailable. Please try again.')
        return response.json() if response.content else []

    def _local(self, table, method, data, item_id):
        with sqlite3.connect(settings().demo_db_path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, owner TEXT, kind TEXT, payload TEXT)')
            db.execute("DELETE FROM records WHERE owner=? AND kind='recipes'", (self.identity.user_id,))
            rows = [json.loads(row[0]) for row in db.execute(
                'SELECT payload FROM records WHERE owner=? AND kind=? ORDER BY rowid DESC',
                (self.identity.user_id, table))]
            if table == 'recipes':
                rows = [json.loads(row[0]) for row in db.execute(
                    "SELECT payload FROM records WHERE owner=? AND kind IN ('recipe_drafts','favorite_recipes') ORDER BY rowid DESC",
                    (self.identity.user_id,))]
            if method == 'GET':
                return [r for r in rows if not item_id or r['id'] == item_id]
            if method == 'POST':
                inserted = []
                for item in data if isinstance(data, list) else [data]:
                    row = {**item, 'id': str(uuid4()), 'user_id': self.identity.user_id,
                           'created_at': datetime.now(timezone.utc).isoformat()}
                    db.execute('INSERT INTO records VALUES (?,?,?,?)',
                               (row['id'], self.identity.user_id, table, json.dumps(row)))
                    inserted.append(row)
                return inserted
            matches = [r for r in rows if not item_id or r['id'] == item_id]
            for row in matches:
                if method == 'DELETE':
                    db.execute('DELETE FROM records WHERE id=? AND owner=?', (row['id'], self.identity.user_id))
                else:
                    row.update(data)
                    db.execute('UPDATE records SET payload=? WHERE id=? AND owner=?',
                               (json.dumps(row), row['id'], self.identity.user_id))
            if table in ('recipes', 'recipe_drafts', 'favorite_recipes') and method == 'DELETE':
                self._clean_local_sessions(db)
            return matches

    def _clean_local_sessions(self, db):
        db.execute("DELETE FROM records AS s WHERE s.owner=? AND s.kind='recipe_sessions' "
                   "AND NOT EXISTS (SELECT 1 FROM records r WHERE r.owner=s.owner AND r.kind IN ('recipe_drafts','favorite_recipes') "
                   "AND json_extract(r.payload,'$.session_id')=s.id)", (self.identity.user_id,))

    async def favorites(self):
        rows, offset = [], 0
        while True:
            page = await self.request('favorite_recipes', filters={'limit': '100', 'offset': str(offset)})
            rows.extend(page)
            if settings().demo_mode or len(page) < 100:
                return rows
            offset += len(page)

    async def save_favorite(self, recipe_id):
        if not settings().demo_mode:
            return await self.request('rpc/save_favorite_recipe', 'POST', {'recipe_id': recipe_id})
        await self.request('favorite_recipes')
        with sqlite3.connect(settings().demo_db_path) as db:
            row = db.execute("SELECT kind,payload FROM records WHERE id=? AND owner=? AND kind IN ('recipe_drafts','favorite_recipes')",
                             (recipe_id,self.identity.user_id)).fetchone()
            if not row:
                return []
            data = json.loads(row[1])
            if row[0] != 'favorite_recipes':
                data['created_at'] = datetime.now(timezone.utc).isoformat()
                db.execute("UPDATE records SET kind='favorite_recipes',payload=? WHERE id=? AND owner=?",
                           (json.dumps(data),recipe_id,self.identity.user_id))
            return [data]

    async def inventory(self):
        return [r for r in await self.request('inventory_items') if not r.get('consumed', False)]

    async def preferences(self):
        rows = await self.request('user_preferences')
        return {k: rows[0][k] for k in Preferences.model_fields} if rows else Preferences().model_dump()

    async def set_preferences(self, data):
        rows = await self.request('user_preferences')
        result = await self.request('user_preferences', 'PATCH' if rows else 'POST', data,
                                    rows[0]['id'] if rows else None)
        return result[0]
