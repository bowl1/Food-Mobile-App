"""Small production log events; no external telemetry service or raw user data."""
from contextlib import contextmanager
from contextvars import ContextVar
import logging
import time

log = logging.getLogger('fridgechef')
request_id = ContextVar('monitoring_request_id', default='')
agent_run_id = ContextVar('monitoring_agent_run_id', default='')


def event(name, **fields):
    log.info('event=%s request_id=%s agent_run_id=%s %s', name, request_id.get(),
             agent_run_id.get(), ' '.join(f'{key}={value}' for key, value in fields.items()))


@contextmanager
def provider_call(model, operation, attempt=1):
    start = time.monotonic()
    status, error_type, http_status = 'success', '', ''
    try:
        yield
    except BaseException as exc:
        status, error_type = 'failure', type(exc).__name__
        http_status = getattr(exc, 'status_code', '')
        raise
    finally:
        event('provider_call', model=model, operation=operation, attempt=attempt,
              status=status, error_type=error_type, http_status=http_status,
              latency_ms=round((time.monotonic() - start) * 1000))
