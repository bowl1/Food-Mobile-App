import { API_BASE_URL } from '@/config/env';
import { useAuthStore } from '@/store/authStore';
import { Recipe, UserProfile } from '@/types/recipe';

function backendHeaders(overrideToken?: string) {
  const token = overrideToken ?? useAuthStore.getState().token;
  if (!token) {
    throw new Error('Missing auth token. Please login again.');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function registerUser(username: string, email: string, token: string) {
  const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: backendHeaders(token),
    body: JSON.stringify({ username, email }),
  });

  if (!response.ok && response.status !== 400) {
    const message = await response.text();
    throw new Error(`Register failed: ${message}`);
  }
}

export async function searchRecipes(keyword: string, selectedTag: string): Promise<Recipe[]> {
  const params = new URLSearchParams({
    keyword,
  });
  if (selectedTag) {
    params.set('tag', selectedTag);
  }
  const endpoint = `${API_BASE_URL}/api/recipes/search?${params.toString()}`;

  const response = await fetch(endpoint, {
    method: 'GET',
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Recipe search failed: ${message}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? (data as Recipe[]) : [];
}

export async function fetchFavorites(): Promise<Recipe[]> {
  const response = await fetch(`${API_BASE_URL}/api/favorites`, {
    headers: backendHeaders(),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Fetch favorites failed: ${message}`);
  }

  return response.json();
}

export async function addFavorite(recipe: Recipe) {
  const response = await fetch(`${API_BASE_URL}/api/favorites`, {
    method: 'POST',
    headers: backendHeaders(),
    body: JSON.stringify(recipe),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Add favorite failed: ${message}`);
  }
}

export async function removeFavorite(recipeId: string) {
  const response = await fetch(`${API_BASE_URL}/api/favorites/${recipeId}`, {
    method: 'DELETE',
    headers: backendHeaders(),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Remove favorite failed: ${message}`);
  }
}

export async function fetchUserProfile(uid: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/api/auth/user/${uid}`, {
    headers: backendHeaders(),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Fetch profile failed: ${message}`);
  }
  return response.json();
}

export async function uploadAvatar(uid: string, avatarBase64: string) {
  const response = await fetch(`${API_BASE_URL}/api/avatar/upload`, {
    method: 'POST',
    headers: backendHeaders(),
    body: JSON.stringify({ uid, avatar: avatarBase64 }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Upload avatar failed: ${message}`);
  }
}
