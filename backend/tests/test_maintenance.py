from datetime import datetime, timezone
import pytest
import httpx
from backend.app import maintenance
from backend.app.config import settings


@pytest.mark.asyncio
async def test_cleanup_retries_are_durable_and_does_not_delete_referenced_images(monkeypatch):
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', 'backend-only')
    settings.cache_clear()
    calls = []
    deleted = []
    owner = '00000000-0000-0000-0000-000000000001'
    async def admin(path, method='POST', data=None, params=None):
        calls.append((path,method,data,params))
        if path == 'image_cleanup_queue' and method == 'GET':
            return [{'path': owner+'/orphan.jpg', 'user_id': owner, 'attempts':0},
                    {'path': owner+'/retained.jpg', 'user_id': owner, 'attempts':0},
                    {'path': 'foreign/image.jpg', 'user_id': owner, 'attempts':0}]
        if path == 'recipes':
            return [{'id':'kept'}] if 'retained' in params['image_path'] else []
        return []
    async def request(self, method, url, **kwargs):
        deleted.extend(kwargs['json']['prefixes'])
        raise httpx.ConnectError('Temporary outage')
    monkeypatch.setattr(maintenance, 'admin', admin)
    monkeypatch.setattr(httpx.AsyncClient, 'request', request)
    try:
        await maintenance.clean_storage()
        assert deleted == [owner+'/orphan.jpg',owner+'/orphan.jpg.thumb.jpg']
        retry = next(call for call in calls if call[1]=='PATCH')
        assert retry[2]['attempts']==1
        assert datetime.fromisoformat(retry[2]['next_attempt_at'])>datetime.now(timezone.utc)
        assert not any(call[1]=='DELETE' and 'orphan' in str(call[3]) for call in calls)
        assert any(call[1]=='DELETE' and 'retained' in str(call[3]) for call in calls)
    finally:
        settings.cache_clear()


def test_recovery_spool_evicts_oldest_files_and_preserves_current_output(monkeypatch,tmp_path):
    import os
    import time
    from backend.app.spool import trim_spool
    root=tmp_path/'spool'
    root.mkdir()
    monkeypatch.setenv('IMAGE_SPOOL_DIR',str(root))
    settings.cache_clear()
    settings().image_spool_max_bytes=10
    old=root/'old.jpg'; old.write_bytes(b'12345678')
    os.utime(old,(time.time()-100,time.time()-100))
    current=root/'current.jpg'; current.write_bytes(b'12345')
    try:
        trim_spool(protect=current)
        assert not old.exists()
        assert current.exists()
    finally:
        settings.cache_clear()
