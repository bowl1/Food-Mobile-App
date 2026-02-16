import { User } from 'firebase/auth';
import { create } from 'zustand';

type AuthState = {
  user: User | null;
  token: string | null;
  ready: boolean;
  setAuth: (user: User | null, token: string | null) => void;
  clearAuth: () => void;
  setReady: (ready: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  ready: false,
  setAuth: (user, token) => set({ user, token }),
  clearAuth: () => set({ user: null, token: null }),
  setReady: (ready) => set({ ready }),
}));
