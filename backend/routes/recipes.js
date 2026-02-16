const express = require('express');

const router = express.Router();
const ANIMAL_TERMS = [
  'chicken',
  'beef',
  'pork',
  'lamb',
  'bacon',
  'ham',
  'turkey',
  'fish',
  'shrimp',
  'anchovy',
  'gelatin',
  'broth',
  'stock',
  'meat',
  'shellfish',
  'sausage',
  'pepperoni',
  'salami',
];

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isExplicitlyFree(text, term) {
  return (
    text.includes(`${term}-free`) ||
    text.includes(`${term} free`) ||
    text.includes(`no ${term}`) ||
    text.includes(`without ${term}`)
  );
}

function hasAnimalIngredient(recipe) {
  const ingredientsText = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map((item) => normalizeText(item?.name ?? item)).join(' ')
    : '';
  const stepsText = Array.isArray(recipe.steps) ? recipe.steps.map((step) => normalizeText(step)).join(' ') : '';
  const nameText = normalizeText(recipe.name);
  const allText = `${nameText} ${ingredientsText} ${stepsText}`;

  return ANIMAL_TERMS.some((term) => {
    const hit = allText.includes(term);
    if (!hit) {
      return false;
    }
    return !isExplicitlyFree(allText, term);
  });
}

router.get('/search', async (req, res) => {
  try {
    const keyword = String(req.query.keyword || '').trim();
    const tag = String(req.query.tag || '').trim();
    const excludeIngredients = String(req.query.excludeIngredients || '').trim();
    const rapidApiKey = process.env.RAPIDAPI_KEY;
    const rapidApiHost = process.env.RAPIDAPI_HOST;

    if (!keyword) {
      return res.status(400).json({ message: 'Missing keyword' });
    }
    if (!rapidApiKey) {
      return res.status(500).json({ message: 'Missing RAPIDAPI_KEY on server' });
    }

    const params = new URLSearchParams({
      includeIngredients: keyword,
    });
    if (tag) {
      params.set('tags', tag);
    }
    if (excludeIngredients) {
      params.set('excludeIngredients', excludeIngredients);
    }
    const endpoint = `https://${rapidApiHost}/search?${params.toString()}`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': rapidApiHost,
      },
    });

    if (!response.ok) {
      const message = await response.text();
      return res.status(response.status).json({ message: `Recipe provider error: ${message}` });
    }

    const data = await response.json();
    const recipes = Array.isArray(data) ? data : [];
    const strictVegetarian = tag.split(';').map((part) => part.trim()).includes('vegetarian');
    if (!strictVegetarian) {
      return res.json(recipes);
    }

    const filteredRecipes = recipes.filter((recipe) => !hasAnimalIngredient(recipe));
    return res.json(filteredRecipes);
  } catch (error) {
    console.error('Failed to search recipes:', error);
    return res.status(500).json({ message: 'Failed to search recipes' });
  }
});

module.exports = router;
