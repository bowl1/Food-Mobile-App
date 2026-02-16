import * as SQLite from 'expo-sqlite';

import { addFavorite, fetchFavorites, removeFavorite } from '@/services/api';
import { Recipe } from '@/types/recipe';

const DB_NAME = 'fridge_cache.db';
const TABLE_NAME = 'favorites';

type SqliteFavoriteRow = {
  recipe_id: string;
  recipe_json: string;
  updated_at: number;
  is_deleted: number;
  dirty: number;
};

export type FavoriteRow = {
  recipeId: string;
  recipe: Recipe;
  updatedAt: number;
  isDeleted: boolean;
  dirty: boolean;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function normalizeRecipe(recipe: Recipe): Recipe {
  return {
    ...recipe,
    id: recipe.id,
    name: recipe.name ?? '',
    image: recipe.image ?? undefined,
    thumbnail: recipe.thumbnail ?? undefined,
    tags: recipe.tags ?? [],
    ingredients: recipe.ingredients ?? [],
    steps: recipe.steps ?? [],
  };
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          recipe_id TEXT PRIMARY KEY NOT NULL,
          recipe_json TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0,
          dirty INTEGER NOT NULL DEFAULT 0
        );`,
      );
      return db;
    })();
  }

  return dbPromise;
}

function toFavoriteRow(row: SqliteFavoriteRow): FavoriteRow {
  return {
    recipeId: row.recipe_id,
    recipe: JSON.parse(row.recipe_json) as Recipe,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
    dirty: row.dirty === 1,
  };
}

function parseRemoteUpdatedAt(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
}

async function getAllFavoriteRows(): Promise<FavoriteRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SqliteFavoriteRow>(
    `SELECT recipe_id, recipe_json, updated_at, is_deleted, dirty FROM ${TABLE_NAME};`,
  );
  return rows.map(toFavoriteRow);
}

async function upsertRow(row: FavoriteRow) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO ${TABLE_NAME} (recipe_id, recipe_json, updated_at, is_deleted, dirty)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(recipe_id) DO UPDATE SET
       recipe_json = excluded.recipe_json,
       updated_at = excluded.updated_at,
       is_deleted = excluded.is_deleted,
       dirty = excluded.dirty;`,
    [row.recipeId, JSON.stringify(normalizeRecipe(row.recipe)), row.updatedAt, row.isDeleted ? 1 : 0, row.dirty ? 1 : 0],
  );
}

async function replaceAllRows(rows: FavoriteRow[]) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM ${TABLE_NAME};`);
    for (const row of rows) {
      await db.runAsync(
        `INSERT INTO ${TABLE_NAME} (recipe_id, recipe_json, updated_at, is_deleted, dirty)
         VALUES (?, ?, ?, ?, ?);`,
        [row.recipeId, JSON.stringify(normalizeRecipe(row.recipe)), row.updatedAt, row.isDeleted ? 1 : 0, row.dirty ? 1 : 0],
      );
    }
  });
}

export async function loadFavoritesFromSQLite(): Promise<Recipe[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SqliteFavoriteRow>(
    `SELECT recipe_id, recipe_json, updated_at, is_deleted, dirty
     FROM ${TABLE_NAME}
     WHERE is_deleted = 0
     ORDER BY updated_at DESC;`,
  );
  return rows.map((row) => JSON.parse(row.recipe_json) as Recipe);
}

export async function toggleFavorite(recipe: Recipe) {
  const db = await getDb();
  const now = Date.now();
  const existing = await db.getFirstAsync<SqliteFavoriteRow>(
    `SELECT recipe_id, recipe_json, updated_at, is_deleted, dirty FROM ${TABLE_NAME} WHERE recipe_id = ?;`,
    [recipe.id],
  );

  const willDelete = existing ? existing.is_deleted === 0 : false;
  const nextRow: FavoriteRow = {
    recipeId: recipe.id,
    recipe: normalizeRecipe(recipe),
    updatedAt: now,
    isDeleted: willDelete,
    dirty: true,
  };

  await upsertRow(nextRow);
  return { isFavorite: !willDelete };
}

export function mergeLocalAndRemote(localRows: FavoriteRow[], remoteRows: Recipe[]): FavoriteRow[] {
  const merged = new Map<string, FavoriteRow>();

  for (const local of localRows) {
    merged.set(local.recipeId, local);
  }

  for (const remoteRecipe of remoteRows) {
    const remoteAny = remoteRecipe as Recipe & { createdAt?: string; updatedAt?: string };
    const remoteRow: FavoriteRow = {
      recipeId: remoteRecipe.id,
      recipe: normalizeRecipe(remoteRecipe),
      updatedAt: parseRemoteUpdatedAt(remoteAny.updatedAt ?? remoteAny.createdAt),
      isDeleted: false,
      dirty: false,
    };

    const local = merged.get(remoteRow.recipeId);
    if (!local) {
      merged.set(remoteRow.recipeId, remoteRow);
      continue;
    }

    if (local.dirty) {
      continue;
    }

    if (local.updatedAt >= remoteRow.updatedAt) {
      merged.set(remoteRow.recipeId, local);
    } else {
      merged.set(remoteRow.recipeId, remoteRow);
    }
  }

  return [...merged.values()];
}

async function pushDirtyRows(localRows: FavoriteRow[]) {
  const dirtyRows = localRows
    .filter((row) => row.dirty)
    .sort((a, b) => a.updatedAt - b.updatedAt);

  for (const row of dirtyRows) {
    if (row.isDeleted) {
      try {
        await removeFavorite(row.recipeId);
      } catch {
        continue;
      }
    } else {
      try {
        await addFavorite(row.recipe);
      } catch (error) {
        const message = String(error);
        if (!message.includes('already in favorites')) {
          continue;
        }
      }
    }

    await upsertRow({
      ...row,
      dirty: false,
    });
  }
}

export async function syncFavorites() {
  const localBeforePush = await getAllFavoriteRows();
  await pushDirtyRows(localBeforePush);

  const localAfterPush = await getAllFavoriteRows();
  const remoteFavorites = await fetchFavorites();
  const merged = mergeLocalAndRemote(localAfterPush, remoteFavorites);
  await replaceAllRows(merged);
}
