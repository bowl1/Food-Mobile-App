"""Conservative v1 taxonomy: unknown foods fail closed for dietary restrictions."""
import re
from .schemas import Recipe, Preferences

STAPLES = {'salt', 'black pepper', 'water', 'cooking oil'}
ALIASES = {'eggs': 'egg', 'tomatoes': 'tomato', 'mushrooms': 'mushroom', 'potatoes': 'potato',
           'bell peppers': 'bell pepper', 'onions': 'onion', 'carrots': 'carrot',
           'olive oil': 'cooking oil', 'pepper': 'black pepper'}
PLANTS = set('spinach mushroom tomato broccoli zucchini cucumber onion carrot lettuce kale avocado rice potato pasta bread oats quinoa lentil chickpea bean tofu tempeh garlic lemon apple banana'.split()) | {'bell pepper', 'sweet potato', 'green bean', 'brown rice', 'gluten-free pasta', 'gluten-free bread'}
MEAT = set('chicken beef pork lamb turkey bacon ham sausage fish salmon tuna shrimp prawn cod anchovy gelatin'.split())
DAIRY = {'milk', 'cheese', 'butter', 'cream', 'yogurt', 'parmesan', 'mozzarella'}
KNOWN = PLANTS | MEAT | DAIRY | {'egg', 'honey'} | STAPLES
CARBS = {'rice', 'brown rice', 'potato', 'sweet potato', 'pasta', 'bread', 'oats', 'banana', 'gluten-free pasta', 'gluten-free bread'}
PROTEIN = MEAT | {'egg', 'tofu', 'tempeh', 'lentil', 'chickpea', 'bean', 'yogurt', 'cheese'}


def normalize(name):
    name = re.sub(r'\s+', ' ', name.strip().lower())
    return ALIASES.get(name, name)


def dietary_errors(names, prefs: Preferences):
    names = {normalize(n) for n in names} - STAPLES
    errors = []
    restricted = prefs.vegan or prefs.vegetarian or prefs.keto or prefs.gluten_free or prefs.dairy_free
    if restricted and names - KNOWN:
        errors.append('Dietary classification unavailable: ' + ', '.join(sorted(names - KNOWN)))
    if (prefs.vegan or prefs.vegetarian) and names & MEAT:
        errors.append('Contains meat or fish')
    if prefs.vegan and names & (DAIRY | {'egg', 'honey'}):
        errors.append('Contains animal products')
    if prefs.dairy_free and names & DAIRY:
        errors.append('Contains dairy')
    if prefs.gluten_free and names & {'pasta', 'bread', 'oats'}:
        errors.append('Contains gluten or unverified oats')
    if prefs.keto and names & CARBS:
        errors.append('Contains high carbohydrate ingredients')
    return errors


def validate_recipe(recipe: Recipe, inventory, prefs: Preferences):
    errors = []
    available = {}
    for item in inventory:
        key = (normalize(item['food_name']), normalize(item['unit']))
        available[key] = available.get(key, 0) + item['quantity']
    used = {}
    for item in recipe.ingredients:
        name = normalize(item.name)
        key = (name, normalize(item.unit))
        used[key] = used.get(key, 0) + item.quantity
        if name not in STAPLES and (key not in available or used[key] > available[key] + 1e-6):
            errors.append(f'Unavailable ingredient, unit or quantity: {item.name}')
    if {normalize(n) for n in recipe.pantry_staples} - STAPLES:
        errors.append('Unapproved pantry staple')
    errors += dietary_errors([i.name for i in recipe.ingredients], prefs)
    # Catch known undeclared food mentions in instructions; evaluator checks unfamiliar additions.
    declared = {normalize(i.name) for i in recipe.ingredients} | {normalize(n) for n in recipe.pantry_staples} | STAPLES
    steps = normalize(' '.join(recipe.steps))
    for food in KNOWN - declared:
        if re.search(r'\b' + re.escape(food) + r'(?:s|es)?\b', steps):
            # Avoid substring conflicts such as "bread" in "gluten-free bread".
            if not any(food in item and item in steps for item in declared):
                errors.append(f'Undeclared food in instructions: {food}')
    if recipe.cooking_time_minutes > prefs.max_cooking_time:
        errors.append('Exceeds maximum cooking time')
    return errors
