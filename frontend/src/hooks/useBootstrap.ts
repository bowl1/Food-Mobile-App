import { onAuthStateChanged } from 'firebase/auth';
import { useEffect } from 'react';

import { auth, setupFirebaseAuthEmulator } from '@/services/firebase';
import { initNotifications } from '@/services/notifications';
import { clearAuthToken, saveAuthToken } from '@/services/secureStore';
import { useAuthStore } from '@/store/authStore';

export function useBootstrap() {
  const setAuth = useAuthStore((state) => state.setAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const setReady = useAuthStore((state) => state.setReady);

  useEffect(() => {
    setupFirebaseAuthEmulator();

    initNotifications().catch((error) => {
      console.warn('Bootstrap init failed:', error);
    });

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          const token = await user.getIdToken();
          await saveAuthToken(token);
          setAuth(user, token);
        } else {
          await clearAuthToken();
          clearAuth();
        }
      } finally {
        setReady(true);
      }
    });

    return () => unsubscribe();
  }, [clearAuth, setAuth, setReady]);
}
