import type { Recipe } from './api';

export const HISTORY_LIMIT = 10;
export function latestHistory(recipes: Recipe[]): Recipe[] {
  return [...recipes].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    || b.id.localeCompare(a.id)).slice(0, HISTORY_LIMIT);
}
