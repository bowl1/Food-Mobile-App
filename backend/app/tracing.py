"""Optional, fail-open Langfuse tracing; never export prompts, photos or tokens."""
from contextlib import contextmanager
from functools import lru_cache, wraps
import logging
from .config import settings

log = logging.getLogger('fridgechef')


@lru_cache
def client():
    cfg = settings()
    if (cfg.app_environment != 'development' or not cfg.langfuse_enabled
            or not cfg.langfuse_public_key or not cfg.langfuse_secret_key):
        return None
    try:
        from langfuse import Langfuse
        return Langfuse(public_key=cfg.langfuse_public_key,
                        secret_key=cfg.langfuse_secret_key,
                        base_url=cfg.langfuse_base_url,
                        environment=cfg.langfuse_environment)
    except Exception:
        log.warning('langfuse_initialization_failed')
        return None


class Observation:
    def __init__(self, span=None):
        self.span = span

    def update(self, **kwargs):
        if self.span is not None:
            try:
                self.span.update(**kwargs)
            except Exception:
                log.warning('langfuse_update_failed')


@contextmanager
def trace(name, **kwargs):
    manager = None
    span = None
    sdk = client()
    if sdk is not None:
        try:
            manager = sdk.start_as_current_observation(name=name, **kwargs)
            span = manager.__enter__()
        except Exception:
            manager = None
            log.warning('langfuse_start_failed')
    observation = Observation(span)
    try:
        yield observation
    except BaseException as exc:
        # Exception messages may contain user data or provider credentials.
        observation.update(level='ERROR', status_message=type(exc).__name__)
        raise
    finally:
        if manager is not None:
            try:
                manager.__exit__(None, None, None)
            except Exception:
                log.warning('langfuse_end_failed')


def traced(name):
    def decorate(fn):
        @wraps(fn)
        async def wrapped(*args, **kwargs):
            with trace(name):
                return await fn(*args, **kwargs)
        return wrapped
    return decorate


def shutdown():
    sdk = client()
    if sdk is not None:
        try:
            sdk.shutdown()
        except Exception:
            log.warning('langfuse_shutdown_failed')
