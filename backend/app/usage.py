"""Provider usage events. Never include prompts, photos or credentials in logs."""
import logging

log = logging.getLogger('fridgechef')


async def record_usage(model, usage, modality):
    if usage is None:
        log.warning('model_usage_missing model=%s modality=%s', model, modality)
        return
    data = usage.model_dump() if hasattr(usage, 'model_dump') else vars(usage)
    log.info('model_usage model=%s modality=%s usage=%s', model, modality, data)
