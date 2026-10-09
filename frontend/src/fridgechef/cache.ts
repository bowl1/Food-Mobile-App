import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';

const names = ['chef-inventory', 'chef-history', 'chef-preferences'];
const maxAge = 24 * 60 * 60 * 1000;
const key = (userId: string) => `fridgechef.data.v1.${userId}`;
let writes: Promise<unknown> = Promise.resolve();
function enqueue(work: () => Promise<unknown>) {
  writes = writes.catch(() => {}).then(work).catch(() => {});
  return writes;
}

export async function restoreKitchenCache(client: QueryClient, userId: string) {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.userId !== userId || !Number.isFinite(saved.savedAt) || Date.now() - saved.savedAt > maxAge) return;
    for (const name of names) {
      const data = saved.data?.[name];
      if (data === undefined) continue;
      if (name !== 'chef-preferences' && !Array.isArray(data)) continue;
      // Old snapshots render immediately but must always revalidate on startup.
      client.setQueryData([name, userId], data, { updatedAt: 0 });
    }
  } catch {
    // Storage errors never prevent login or loading authoritative cloud data.
  }
}

export function watchKitchenCache(client: QueryClient, userId: string) {
  return client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const [name, owner] = event.query.queryKey;
    if (owner !== userId || !names.includes(String(name))) return;
    const data: Record<string, unknown> = {};
    for (const name of names) {
      const value = client.getQueryData([name, userId]);
      if (value !== undefined) data[name] = value;
    }
    const snapshot = JSON.stringify({ userId, savedAt: Date.now(), data });
    void enqueue(() => AsyncStorage.setItem(key(userId), snapshot));
  });
}

export async function clearKitchenCache(userId: string) {
  // Queue deletion after pending writes so logout cannot recreate the snapshot.
  await enqueue(() => AsyncStorage.removeItem(key(userId)));
}
