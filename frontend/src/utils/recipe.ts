import { Recipe } from '@/types/recipe';

export function recipeImage(recipe: Recipe) {
  return recipe.thumbnail || recipe.image;
}
