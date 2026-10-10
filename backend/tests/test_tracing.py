"""Tracing failures must not change API work or export sensitive exceptions."""
import asyncio
from contextlib import contextmanager
from types import SimpleNamespace
import pytest
from backend.app import tracing


def test_disabled_and_broken_sdk_do_not_interrupt_work(monkeypatch):
    monkeypatch.setattr(tracing, 'client', lambda: None)
    with tracing.trace('disabled') as observation:
        observation.update(output={'count': 1})
    def broken(**kwargs):
        raise RuntimeError('secret')
    monkeypatch.setattr(tracing, 'client', lambda: SimpleNamespace(start_as_current_observation=broken))
    with tracing.trace('broken'):
        pass


def test_application_error_is_preserved_and_sanitized(monkeypatch):
    events = []
    @contextmanager
    def start(**kwargs):
        yield SimpleNamespace(update=lambda **values: events.append(values))
    monkeypatch.setattr(tracing, 'client', lambda: SimpleNamespace(start_as_current_observation=start))
    with pytest.raises(ValueError, match='private photo'):
        with tracing.trace('work'):
            raise ValueError('private photo')
    assert events == [{'level': 'ERROR', 'status_message': 'ValueError'}]


@pytest.mark.asyncio
async def test_concurrent_observations_keep_separate_context(monkeypatch):
    from contextvars import ContextVar
    current = ContextVar('test_current', default=None)
    seen = []
    @contextmanager
    def start(name, **kwargs):
        parent = current.get()
        token = current.set(name)
        seen.append((name, parent))
        try:
            yield SimpleNamespace(update=lambda **values: None)
        finally:
            current.reset(token)
    monkeypatch.setattr(tracing, 'client', lambda: SimpleNamespace(start_as_current_observation=start))
    async def work(name):
        with tracing.trace(name):
            await asyncio.sleep(0)
            with tracing.trace(name + '.child'):
                pass
    await asyncio.gather(work('one'), work('two'))
    assert ('one.child', 'one') in seen and ('two.child', 'two') in seen
    assert current.get() is None


def test_real_sdk_exports_nested_spans_without_sensitive_payload(monkeypatch):
    from langfuse import Langfuse
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
    class Exporter(SpanExporter):
        def __init__(self):
            self.spans = []
        def export(self, spans):
            self.spans.extend(spans)
            return SpanExportResult.SUCCESS
        def shutdown(self):
            pass
    exporter = Exporter()
    sdk = Langfuse(public_key='pk-lf-test-local', secret_key='test-local',
                   tracer_provider=TracerProvider(), span_exporter=exporter)
    monkeypatch.setattr(tracing, 'client', lambda: sdk)
    with tracing.trace('recipes.generate', metadata={'agent_run_id': 'local-test'}):
        with tracing.trace('llm.Candidates', as_type='generation', model='test-model') as observation:
            observation.update(usage_details={'input': 2, 'output': 3},
                               cost_details={'input': 0.001, 'output': 0.002})
    sdk.flush()
    sdk.shutdown()
    spans = {span.name: span for span in exporter.spans}
    assert spans['llm.Candidates'].parent.span_id == spans['recipes.generate'].context.span_id
    assert spans['llm.Candidates'].context.trace_id == spans['recipes.generate'].context.trace_id
    assert all('input' not in key or 'usage' in key or 'cost' in key
               for span in spans.values() for key in span.attributes)


@pytest.mark.parametrize('environment,enabled', [('production', True), ('development', False)])
def test_production_or_disabled_never_initializes_sdk(monkeypatch, environment, enabled):
    import langfuse
    def forbidden(**kwargs):
        pytest.fail('SDK must not initialize')
    monkeypatch.setattr(langfuse, 'Langfuse', forbidden)
    monkeypatch.setattr(tracing, 'settings', lambda: SimpleNamespace(
        app_environment=environment, langfuse_enabled=enabled,
        langfuse_public_key='present', langfuse_secret_key='present'))
    tracing.client.cache_clear()
    try:
        assert tracing.client() is None
    finally:
        tracing.client.cache_clear()


@pytest.mark.asyncio
async def test_real_sdk_user_session_propagates_without_cross_request_leak(monkeypatch):
    from langfuse import Langfuse
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
    class Exporter(SpanExporter):
        def __init__(self):
            self.spans = []
        def export(self, spans):
            self.spans.extend(spans)
            return SpanExportResult.SUCCESS
        def shutdown(self):
            pass
    exporter = Exporter()
    sdk = Langfuse(public_key='pk-lf-identity-test', secret_key='local-test',
                   tracer_provider=TracerProvider(), span_exporter=exporter)
    monkeypatch.setattr(tracing, 'client', lambda: sdk)
    async def work(user, session, name):
        with tracing.identity(user, session), tracing.trace(name):
            await asyncio.sleep(0)
            with tracing.trace(name + '.llm'):
                pass
    await asyncio.gather(work('user-one', 'operation-one', 'scan'),
                         work('user-two', 'operation-two', 'other'))
    await work('user-one', 'operation-one', 'generate')
    await work('user-one', 'operation-one', 'image')
    with tracing.trace('outside'):
        pass
    sdk.flush()
    sdk.shutdown()
    for span in exporter.spans:
        if span.name == 'outside':
            assert 'user.id' not in span.attributes
            assert 'session.id' not in span.attributes
        else:
            expected = 'two' if span.name.startswith('other') else 'one'
            assert span.attributes['user.id'] == f'user-{expected}'
            assert span.attributes['session.id'] == f'operation-{expected}'


@pytest.mark.asyncio
async def test_paid_action_uses_verified_user_and_database_operation(monkeypatch):
    from backend.app import costs
    from backend.app.auth import Identity
    from backend.app.config import settings
    cfg = settings().model_copy(update={'demo_mode': False})
    monkeypatch.setattr(costs, 'settings', lambda: cfg)
    identities = []
    @contextmanager
    def identity(user_id, session_id):
        identities.append((user_id, session_id))
        yield
    monkeypatch.setattr(tracing, 'identity', identity)
    monkeypatch.setattr(tracing, 'client', lambda: None)
    async def admin(path, method='POST', data=None, params=None):
        if path.startswith('rpc/'):
            return {'state': 'reserved', 'free_operation_id': 'server-operation'}
        return [{}]
    monkeypatch.setattr(costs, 'admin', admin)
    async def action():
        assert costs.active_free_operation.get() == 'server-operation'
        return {'recipes': []}
    result = await costs.run_paid(Identity('verified-user', 'private-token'), 'generate',
                                 'job', {'user_id': 'forged-user'}, action)
    assert identities == [('verified-user', 'server-operation')]
    assert result['free_operation_id'] == 'server-operation'
    assert costs.active_job.get() is None
