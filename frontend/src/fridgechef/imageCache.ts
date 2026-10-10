import { Platform } from 'react-native';
import * as FS from 'expo-file-system/legacy';

const root = FS.cacheDirectory ? `${FS.cacheDirectory}fridgeout-images/` : '';
const pending = new Map<string, Promise<string | undefined>>();
const versions = new Map<string, number>();
const ownerVersions = new Map<string, number>();
const safe = (value: string) => /^[a-zA-Z0-9-]+$/.test(value);
const folder = (owner: string) => root && safe(owner) ? `${root}${owner}/` : '';
const file = (owner: string, recipe: string, detail: boolean) => folder(owner) && safe(recipe)
  ? `${folder(owner)}${recipe}-${detail ? 'full' : 'thumb'}.jpg` : '';

export async function cachedImage(owner: string, recipe: string, detail: boolean) {
  const uri = file(owner, recipe, detail);
  if (Platform.OS === 'web' || !uri) return undefined;
  try {
    const info = await FS.getInfoAsync(uri);
    return info.exists && !info.isDirectory && info.size > 0 ? uri : undefined;
  } catch { return undefined; }
}
async function prune(owner: string) {
  const dir = folder(owner);
  const names = await FS.readDirectoryAsync(dir);
  const entries = await Promise.all(names.filter(n => n.endsWith('.jpg')).map(async name => {
    const uri = dir + name, info = await FS.getInfoAsync(uri);
    return { uri, size: info.exists ? info.size : 0, time: info.exists ? info.modificationTime ?? 0 : 0 };
  }));
  let size = entries.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of entries.sort((a, b) => a.time - b.time)) {
    if (size <= 64 * 1024 * 1024) break;
    await FS.deleteAsync(entry.uri, { idempotent: true }); size -= entry.size;
  }
}
export async function storeImage(owner: string, recipe: string, detail: boolean, url: string) {
  const target = file(owner, recipe, detail);
  if (Platform.OS === 'web' || !target) return undefined;
  if (pending.has(target)) return pending.get(target);
  const key = `${owner}/${recipe}`, version = versions.get(key) ?? 0, ownerVersion = ownerVersions.get(owner) ?? 0;
  const work = (async () => {
    const temp = target + '.download';
    try {
      const existing = await cachedImage(owner, recipe, detail);
      if (existing) return existing;
      await FS.makeDirectoryAsync(folder(owner), { intermediates: true });
      const result = await FS.downloadAsync(url, temp);
      const info = await FS.getInfoAsync(temp);
      if (result.status !== 200 || !info.exists || info.size <= 0 || info.size > 12 * 1024 * 1024) return undefined;
      if (version !== (versions.get(key) ?? 0) || ownerVersion !== (ownerVersions.get(owner) ?? 0)) return undefined;
      await FS.moveAsync({ from: temp, to: target });
      await prune(owner);
      return await cachedImage(owner, recipe, detail);
    } catch { return undefined; }
    finally { await FS.deleteAsync(temp, { idempotent: true }).catch(() => {}); }
  })();
  pending.set(target, work);
  try { return await work; } finally { pending.delete(target); }
}
export async function removeCachedImage(owner: string, recipe: string) {
  const key = `${owner}/${recipe}`;
  versions.set(key, (versions.get(key) ?? 0) + 1);
  if (Platform.OS === 'web') return;
  await Promise.all([false, true].map(detail => pending.get(file(owner, recipe, detail))));
  await Promise.all([false, true].map(async detail => {
    const uri = file(owner, recipe, detail);
    if (uri) await FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }));
}
export async function clearImageCache(owner: string) {
  ownerVersions.set(owner, (ownerVersions.get(owner) ?? 0) + 1);
  const dir = folder(owner);
  if (Platform.OS !== 'web' && dir) {
    await Promise.all([...pending.entries()].filter(([path]) => path.startsWith(dir)).map(([, work]) => work));
    await FS.deleteAsync(dir, { idempotent: true }).catch(() => {});
  }
}
