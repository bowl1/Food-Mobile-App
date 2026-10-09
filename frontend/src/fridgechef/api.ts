import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const DEMO = process.env.EXPO_PUBLIC_DEMO_MODE === '1';
const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000');
const SUPABASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const STORAGE_KEY = 'fridgechef.session.v1';
export type Session = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email?: string } };
export type Food = { id: string; food_name: string; quantity: number; unit: string; source: 'manual' | 'image_recognition'; confidence?: number };
export type Preferences = { vegetarian: boolean; vegan: boolean; keto: boolean; gluten_free: boolean; dairy_free: boolean; high_protein: boolean; max_cooking_time: number };
export type Recipe = { image_status?: 'none' | 'pending' | 'generating' | 'ready' | 'failed'; id: string; recipe_name: string; ingredients: { name: string; quantity: number; unit: string }[]; pantry_staples: string[]; cooking_time_minutes: number; dietary_tags: string[]; steps: string[]; reason: string; evaluation_score: number; evaluation: Record<string, number>; created_at: string };
export const defaults: Preferences = { vegetarian: false, vegan: false, keto: false, gluten_free: false, dairy_free: false, high_protein: false, max_cooking_time: 30 };
let current: Session | null = null;
let refreshing: Promise<Session> | null = null;

async function persist(session: Session | null) {
  current = session;
  if (Platform.OS === 'web') {
    // Web keeps credentials in memory only; native uses encrypted OS storage.
    return;
  }
  if (session) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(session));
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
}

async function authRequest(path: string, body: object) {
  if (!SUPABASE || !KEY) throw new Error('Configure Supabase in frontend/.env, or use the explicit demo mode.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${SUPABASE}/auth/v1/${path}`, {
      method: 'POST', signal: controller.signal,
      headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.msg ?? result.error_description ?? result.message ?? 'Authentication failed.');
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Authentication timed out. Check your connection and try again.');
    if (error instanceof TypeError) throw new Error('Unable to connect to authentication. Check your internet connection and try again.');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function signIn(email: string, password: string, register: boolean) {
  const data = await authRequest(register ? 'signup' : 'token?grant_type=password', { email: email.trim(), password });
  if (!data.access_token) return null; // Supabase email confirmation enabled.
  const session = { ...data, expires_at: Math.floor(Date.now() / 1000) + data.expires_in } as Session;
  await persist(session);
  return session;
}

export async function restoreSession() {
  if (DEMO) {
    current = { access_token: 'local-demo', refresh_token: '', expires_at: Infinity, user: { id: 'demo', email: 'Local demo' } };
    return current;
  }
  if (Platform.OS !== 'web') {
    const saved = await SecureStore.getItemAsync(STORAGE_KEY);
    if (saved) {
      try { current = JSON.parse(saved); } catch { await persist(null); }
    }
  }
  if (current) {
    try { await token(); } catch { await persist(null); }
  }
  return current;
}

async function token(): Promise<string> {
  if (!current) throw new Error('Please sign in to continue.');
  if (current.expires_at > Date.now() / 1000 + 60) return current.access_token;
  if (!refreshing) {
    refreshing = (async () => {
      const data = await authRequest('token?grant_type=refresh_token', { refresh_token: current!.refresh_token });
      const session = { ...data, expires_at: Math.floor(Date.now() / 1000) + data.expires_in } as Session;
      await persist(session);
      return session;
    })().finally(() => { refreshing = null; });
  }
  return (await refreshing).access_token;
}

export async function signOut() {
  const access = current?.access_token;
  await persist(null);
  if (!DEMO && access) {
    // Clear local credentials even if revocation service is unavailable.
    await fetch(`${SUPABASE}/auth/v1/logout`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${access}` } }).catch(() => {});
  }
}

export async function api<T>(path: string, method = 'GET', body?: unknown, requestId?: string, freeOperation?: string): Promise<T> {
  const access = await token();
  if (!requestId && path === '/vision/recognize') requestId = requestUuid();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), path === '/recipes/generate' ? 250000 : path.includes('/image') ? 180000 : 100000);
  try {
    const response = await fetch(`${BASE}${path}`, { method, signal: controller.signal,
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', ...(requestId ? { 'Idempotency-Key': requestId } : {}), ...(freeOperation ? { 'X-Free-Operation': freeOperation } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status === 204) return undefined as T;
    const result = await response.json();
    if (!response.ok) throw new ApiError(typeof result.detail === 'string' ? result.detail : 'Please check your input and try again.', response.status, response.headers.get('X-AI-Job-State'));
    if (path === '/vision/recognize' && result.free_operation_id && current) {
      const key = freeOperationKey(current.user.id);
      const saved = await operationQueue(current.user.id);
      if (!saved.includes(result.free_operation_id)) await AsyncStorage.setItem(key, JSON.stringify([...saved, result.free_operation_id]));
    }
    return result as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('This request timed out. Please try again.');
    throw error;
  } finally { clearTimeout(timer); }
}


export class ApiError extends Error {
  constructor(message: string, public status: number, public jobState: string | null) { super(message); }
}

function requestUuid() {
  // An identifier, not an authentication credential.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

export async function paidGenerate<T>(context: unknown): Promise<T> {
  if (DEMO) return api<T>('/recipes/generate', 'POST');
  const owner = current?.user.id;
  if (!owner) throw new Error('Please sign in.');
  const key = `fridgechef.pending-generation.v1.${owner}`;
  const fingerprint = JSON.stringify(context);
  let pending: { id: string; context: string; operation?: string } | null = null;
  try { pending = JSON.parse(await AsyncStorage.getItem(key) ?? 'null'); } catch { /* Replace malformed local state. */ }
  if (!pending || pending.context !== fingerprint) {
    const queue = await operationQueue(owner);
    pending = { id: requestUuid(), context: fingerprint, operation: queue[0] };
    await AsyncStorage.setItem(key, JSON.stringify(pending));
  }
  try {
    const result = await api<T>('/recipes/generate', 'POST', undefined, pending.id, pending.operation);
    await AsyncStorage.removeItem(key);
    if (pending.operation) await consumeOperation(owner, pending.operation);
    return result;
  } catch (error) {
    // Keep the ID on network errors/unknown server outcomes and while still running.
    // A definitive failed job allows the next explicit tap to start a new job.
    if (error instanceof ApiError && ['failed', 'conflict', 'operation_used', 'operation_required'].includes(error.jobState ?? '')) {
      await AsyncStorage.removeItem(key);
      if (pending.operation) await consumeOperation(owner, pending.operation);
    }
    throw error;
  }
}


function freeOperationKey(owner: string) { return `fridgechef.free-operations.v1.${owner}`; }
async function operationQueue(owner: string): Promise<string[]> {
  try {
    const saved: unknown = JSON.parse(await AsyncStorage.getItem(freeOperationKey(owner)) ?? '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}
async function consumeOperation(owner: string, id: string) {
  const saved = await operationQueue(owner);
  await AsyncStorage.setItem(freeOperationKey(owner), JSON.stringify(saved.filter(item => item !== id)));
}
export type FreeTrial = { total_uses: number; remaining_uses: number; exhausted: boolean; demo?: boolean };
