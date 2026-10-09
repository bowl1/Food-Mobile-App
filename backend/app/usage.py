"""Provider usage events. Never include prompts, photos or credentials in logs."""
import logging

log = logging.getLogger('fridgechef')


async def record_usage(model, usage, modality):
    if usage is None:
        log.warning('model_usage_missing model=%s modality=%s', model, modality)
        return
    data = usage.model_dump() if hasattr(usage, 'model_dump') else vars(usage)
    log.info('model_usage model=%s modality=%s usage=%s', model, modality, data)

    from .costs import active_job, admin
    from .config import settings
    job = active_job.get()
    if job:
        # Store detailed usage, including cached/reasoning tokens returned by OpenAI.
        # Estimates use configured rates; the provider invoice is authoritative.
        rate_in, rate_out = (settings().ai_text_input_usd_per_million,
                            settings().ai_text_output_usd_per_million)
        if modality == 'image':
            rate_in, rate_out = settings().ai_image_text_usd_per_million, settings().ai_image_output_usd_per_million
        cost = (data.get('input_tokens', data.get('prompt_tokens', 0)) * rate_in +
                data.get('output_tokens', data.get('completion_tokens', 0)) * rate_out) / 1_000_000
        try:
            await admin('ai_usage', data={'user_id': job[0], 'job_id': job[1],
                'model': model, 'modality': modality, 'usage': data, 'estimated_usd': cost})
        except Exception:
            log.error('usage_persist_failed user_id=%s job_id=%s', *job)
