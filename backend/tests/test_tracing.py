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
