import logging
import pytest
from backend.app.monitoring import provider_call, request_id


def test_provider_success_failure_and_no_sensitive_error(caplog):
    token = request_id.set('request-test')
    try:
        with caplog.at_level(logging.INFO, logger='fridgechef'):
            with provider_call('test-model', 'text'):
                pass
            with pytest.raises(ValueError, match='secret-photo'):
                with provider_call('test-model', 'image'):
                    raise ValueError('secret-photo')
    finally:
        request_id.reset(token)
    assert 'status=success' in caplog.text
    assert 'status=failure' in caplog.text
    assert 'error_type=ValueError' in caplog.text
    assert 'request_id=request-test' in caplog.text
    assert 'secret-photo' not in caplog.text
    assert request_id.get() == ''
