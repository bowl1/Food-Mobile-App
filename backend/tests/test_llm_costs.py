from types import SimpleNamespace
import pytest
from backend.app import llm
from backend.app.schemas import Evaluations, IndexedEvaluation, Evaluation


@pytest.mark.asyncio
async def test_batch_maps_indices_and_rejects_duplicates(monkeypatch):
    score = Evaluation(**{k: .9 for k in Evaluation.model_fields})
    recipe = SimpleNamespace(model_dump=lambda: {'recipe_name': 'Meal'})
    async def respond(*args, **kwargs):
        return Evaluations(evaluations=[IndexedEvaluation(candidate_index=1, evaluation=score),
                                       IndexedEvaluation(candidate_index=0, evaluation=score)])
    monkeypatch.setattr(llm, 'structured', respond)
    assert await llm.evaluate_many([recipe, recipe], [], {}) == [score, score]
    async def duplicate(*args, **kwargs):
        return Evaluations(evaluations=[IndexedEvaluation(candidate_index=0, evaluation=score)] * 2)
    monkeypatch.setattr(llm, 'structured', duplicate)
    with pytest.raises(ValueError):
        await llm.evaluate_many([recipe, recipe], [], {})


@pytest.mark.asyncio
async def test_timeout_is_not_automatically_repeated(monkeypatch):
    calls = []
    async def parse(**kwargs):
        calls.append(kwargs)
        raise TimeoutError('Uncertain provider outcome')
    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(parse=parse))
        async def close(self): pass
    monkeypatch.setattr(llm, 'AsyncOpenAI', Client)
    with pytest.raises(TimeoutError):
        await llm.structured(Evaluation, [], max_tokens=123)
    assert len(calls) == 1
    assert calls[0]['max_completion_tokens'] == 123
