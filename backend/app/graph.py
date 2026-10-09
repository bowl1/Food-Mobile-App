import asyncio
import logging
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from .schemas import Preferences, Recipe
from .guardrails import validate_recipe
from .config import settings
from . import llm, demo

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
    async def load(state):
        # Any tool failure propagates: never generate from guessed inventory.
        return {'inventory': await call_tool('get_inventory'),
                'preferences': await call_tool('get_user_preferences'), 'attempts': 0, 'accepted': [], 'errors': []}

    async def generate(state):
        if not state['inventory']:
            return {'candidates': [], 'attempts': 0}
        candidates = demo.candidates(state['inventory'], state['preferences']) if settings().demo_mode else (
            await llm.generate(state['inventory'], state['preferences'], state['errors'])).recipes
        return {'candidates': candidates, 'attempts': state['attempts'] + 1}

    async def validate(state):
        accepted = list(state['accepted'])
        errors = []
        prefs = Preferences(**state['preferences'])
        valid = []
        for recipe in state['candidates']:
            failures = validate_recipe(recipe, state['inventory'], prefs)
            if failures:
                errors.extend(failures)
                log.info('guardrail_failure count=%s', len(failures))
                continue
            valid.append(recipe)

        slots = asyncio.Semaphore(3)
        async def evaluate(recipe):
            async with slots:
                return demo.score(recipe, state['inventory']) if settings().demo_mode else await llm.evaluate(
                    recipe, state['inventory'], state['preferences'])

        tasks = [asyncio.create_task(evaluate(recipe)) for recipe in valid]
        try:
            evaluations = await asyncio.gather(*tasks)
        except BaseException:
            # A failed request or deadline must not leave sibling model calls running.
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        # gather preserves input order, keeping deduplication and ties deterministic.
        for recipe, evaluation in zip(valid, evaluations):
            log.info('evaluation overall_score=%s attempt=%s', evaluation.overall_score, state['attempts'])
            if evaluation.overall_score < 0.75:
                errors.append(f'{recipe.recipe_name}: evaluator score below 0.75')
                continue
            if recipe.recipe_name.casefold() not in {r['recipe'].recipe_name.casefold() for r in accepted}:
                accepted.append({'recipe': recipe, 'evaluation': evaluation})
        return {'accepted': accepted, 'errors': errors}

    def route(state):
        return 'generate' if state['inventory'] and len(state['accepted']) < 3 and state['attempts'] < 3 else 'rank'

    def rank(state):
        return {'final_recipes': sorted(state['accepted'], key=lambda r: r['evaluation'].overall_score, reverse=True)[:3]}

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
