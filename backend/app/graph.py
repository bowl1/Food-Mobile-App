import asyncio
import logging
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from .schemas import Preferences, Recipe
from .guardrails import validate_recipe
from .config import settings
from . import llm, demo
from .tracing import trace, traced
from .monitoring import event

log = logging.getLogger('fridgechef')


class AgentState(TypedDict, total=False):
    inventory: list
    preferences: dict
    candidates: list
    accepted: list
    final_recipes: list
    errors: list
    attempts: int


def build_graph(call_tool):
    @traced('load_context')
    async def load(state):
        # Any tool failure propagates: never generate from guessed inventory.
        return {'inventory': await call_tool('get_inventory'),
                'preferences': await call_tool('get_user_preferences'), 'attempts': 0, 'accepted': [], 'errors': []}

    async def generate(state):
        if not state['inventory']:
            return {'candidates': [], 'attempts': 0}
        feedback = list(state['errors'])
        if state['accepted']:
            names = [row['recipe'].recipe_name for row in state['accepted']]
            feedback.append(f'Need {5 - len(names)} additional distinct recipes. Do not repeat accepted names: {names}')
        with trace('generate_candidates', metadata={'attempt': state['attempts'] + 1}) as observation:
            candidates = demo.candidates(state['inventory'], state['preferences']) if settings().demo_mode else (
                await llm.generate(state['inventory'], state['preferences'], feedback)).recipes
            observation.update(output={'candidate_count': len(candidates)})
        return {'candidates': candidates, 'attempts': state['attempts'] + 1}

    @traced('validate_evaluate')
    async def validate(state):
        accepted = list(state['accepted'])
        errors = []
        prefs = Preferences(**state['preferences'])
        valid = []
        rejected = []
        duplicate_count = 0
        low_score_count = 0
        with trace('guardrails', as_type='guardrail', metadata={'attempt': state['attempts']}) as observation:
            for recipe in state['candidates']:
                failures = validate_recipe(recipe, state['inventory'], prefs)
                if failures:
                    errors.extend(failures)
                    rejected.append({'candidate_index': len(valid) + len(rejected),
                                     'reasons': [f.split(':')[0] for f in failures]})
                    log.info('guardrail_failure count=%s', len(failures))
                    continue
                valid.append(recipe)
            event('guardrails', attempt=state['attempts'], candidate_count=len(state['candidates']),
                  rejected_count=len(rejected), failure_count=sum(len(r['reasons']) for r in rejected))
            observation.update(output={'candidate_count': len(state['candidates']),
                                       'valid_count': len(valid), 'rejected': rejected})

        with trace('evaluate_candidates', metadata={'attempt': state['attempts']}):
            evaluations = ([demo.score(recipe, state['inventory']) for recipe in valid]
                           if settings().demo_mode else
                           await llm.evaluate_many(valid, state['inventory'], state['preferences']) if valid else [])
        # Indexed batch results preserve candidate order for deterministic ranking.
        for recipe, evaluation in zip(valid, evaluations):
            log.info('evaluation overall_score=%s attempt=%s', evaluation.overall_score, state['attempts'])
            if evaluation.overall_score < 0.75:
                low_score_count += 1
                errors.append(f'{recipe.recipe_name}: evaluator score below 0.75')
                continue
            if recipe.recipe_name.casefold() not in {r['recipe'].recipe_name.casefold() for r in accepted}:
                accepted.append({'recipe': recipe, 'evaluation': evaluation})
            else:
                duplicate_count += 1
        with trace('selection', metadata={'attempt': state['attempts']}) as observation:
            observation.update(output={'scores': [e.overall_score for e in evaluations],
                'duplicate_count': duplicate_count, 'low_score_count': low_score_count,
                'accepted_this_round': len(accepted) - len(state['accepted']),
                'accepted_total': len(accepted)})
        event('recipe_round', attempt=state['attempts'], candidate_count=len(state['candidates']),
              valid_count=len(valid), duplicate_count=duplicate_count, low_score_count=low_score_count,
              accepted_total=len(accepted))
        return {'accepted': accepted, 'errors': errors}

    def route(state):
        return 'generate' if state['inventory'] and len(state['accepted']) < 5 and state['attempts'] < 3 else 'rank'

    def rank(state):
        return {'final_recipes': sorted(state['accepted'], key=lambda r: r['evaluation'].overall_score, reverse=True)[:5]}

    graph = StateGraph(AgentState)
    graph.add_node('load_context', load)
    graph.add_node('generate', generate)
    graph.add_node('validate_evaluate', validate)
    graph.add_node('rank', rank)
    graph.add_edge(START, 'load_context')
    graph.add_edge('load_context', 'generate')
    graph.add_edge('generate', 'validate_evaluate')
    graph.add_conditional_edges('validate_evaluate', route, {'generate': 'generate', 'rank': 'rank'})
    graph.add_edge('rank', END)
    return graph.compile()
