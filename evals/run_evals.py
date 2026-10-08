"""Offline graph evals. Real mode calls the configured model, demo mode tests fixtures only."""
import asyncio
import json
from pathlib import Path
from backend.app.config import settings
from backend.app.graph import build_graph
from backend.app.schemas import Preferences
from backend.app.guardrails import validate_recipe, dietary_errors


async def main():
    cases = json.loads((Path(__file__).parent / 'datasets/recipe_cases.json').read_text())
    results = []
    scores = []
    total = dietary_pass = inventory_pass = hallucinations = regenerations = 0
    for case in cases:
        prefs = Preferences(**case['preferences'])
        async def tool(name):
            return case['inventory'] if name == 'get_inventory' else prefs.model_dump()
        try:
            result = await build_graph(tool).ainvoke({})
            rows = result['final_recipes']
            for row in rows:
                recipe = row['recipe']
                total += 1
                failures = validate_recipe(recipe, case['inventory'], prefs)
                dietary_pass += not bool(dietary_errors([i.name for i in recipe.ingredients], prefs))
                invent = any('Unavailable' in e or 'Unapproved' in e or 'Undeclared' in e for e in failures)
                inventory_pass += not invent
                hallucinations += invent
                scores.append(row['evaluation'].overall_score)
            passed = not rows if case['expect_no_recipes'] else bool(rows)
            regenerations += result['attempts'] > 1
            results.append({'case': case['name'], 'pass': passed, 'recipes': len(rows), 'attempts': result['attempts']})
        except Exception as exc:
            results.append({'case': case['name'], 'pass': False, 'error_type': type(exc).__name__})
    report = {'mode': 'demo-fixtures' if settings().demo_mode else 'live-model', 'cases': results,
        'metrics': {'case_success_rate': sum(r['pass'] for r in results) / len(cases),
        'dietary_compliance_rate': dietary_pass / total if total else None,
        'inventory_constraint_success_rate': inventory_pass / total if total else None,
        'hallucinated_ingredient_rate': hallucinations / total if total else None,
        'average_evaluator_score': sum(scores) / total if total else None,
        'regeneration_rate': regenerations / len(cases)}}
    print(json.dumps(report, indent=2))
    return all(r['pass'] for r in results)


if __name__ == '__main__':
    raise SystemExit(0 if asyncio.run(main()) else 1)
