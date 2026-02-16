import * as SQLite from 'expo-sqlite';

const DB_NAME = 'fridge_cache.db';
const TABLE_NAME = 'query_cache';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(
        `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );`,
      );
      return db;
    })();
  }

  return dbPromise;
}

export const querySqliteStorage = {
  async getItem(key: string) {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM ${TABLE_NAME} WHERE key = ?;`, [key]);
    return row?.value ?? null;
  },
  async setItem(key: string, value: string) {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO ${TABLE_NAME} (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
      [key, value, Date.now()],
    );
  },
  async removeItem(key: string) {
    const db = await getDb();
    await db.runAsync(`DELETE FROM ${TABLE_NAME} WHERE key = ?;`, [key]);
  },
};
