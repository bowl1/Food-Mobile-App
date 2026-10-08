"""Deterministic demo fixtures, deliberately separate from real AI behavior."""
from .schemas import Recipe, Ingredient, Evaluation, Preferences
from .guardrails import dietary_errors, normalize


def candidates(inventory, preferences):
    prefs = Preferences(**preferences)
    allowed = [i for i in inventory if not dietary_errors([i['food_name']], prefs)]
    if len(allowed) < 2:
        return []
    result = []
    for title, minutes, technique in [
        ('Simple skillet', 15, 'Heat cooking oil in a pan. Add the prepared ingredients and cook, stirring, until cooked through.'),
        ('Warm vegetable bowl', 20, 'Heat cooking oil in a pan. Cook the prepared ingredients in batches, then combine in a bowl.'),
        ('One-pan supper', 25, 'Heat cooking oil in a pan. Add the prepared ingredients, cover, and cook gently until cooked through.')]:
        # Demo supports quick-cooking ingredients only, never raw rice/meat/beans with generic steps.
        items = [i for i in allowed if normalize(i['food_name']) in {'egg', 'spinach', 'mushroom', 'tomato', 'cheese', 'tofu', 'zucchini', 'broccoli'}]
        if len(items) < 2 or minutes > prefs.max_cooking_time:
            continue
        result.append(Recipe(recipe_name=f"{items[0]['food_name'].title()} & {items[1]['food_name']} · {title}",
            ingredients=[Ingredient(name=i['food_name'], quantity=i['quantity'], unit=i['unit']) for i in items[:4]],
            pantry_staples=['salt', 'black pepper', 'cooking oil'], cooking_time_minutes=minutes,
            dietary_tags=[k.replace('_', '-') for k, v in preferences.items() if v is True],
            steps=['Wash and prepare the vegetables; slice into small, even pieces.' + (' Beat egg.' if any(normalize(i['food_name']) == 'egg' for i in items[:4]) else ''), technique,
                   'Season with salt and black pepper, divide into a serving bowl and serve.'],
            reason='Demo recipe using your confirmed inventory. Real AI provides more detailed cooking instructions.'))
    return result


def score(recipe, inventory):
    return Evaluation(inventory_utilization=min(len(recipe.ingredients) / max(len(inventory), 1), 1),
        dietary_fit=1, recipe_feasibility=0.8, cooking_time_fit=1, instruction_quality=0.8, overall_score=0.84)
