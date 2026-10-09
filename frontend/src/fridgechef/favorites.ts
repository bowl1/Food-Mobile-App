import type { Recipe } from './api';

export function sortFavorites(recipes: Recipe[]): Recipe[] {
  return [...recipes].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    || b.id.localeCompare(a.id));
}
