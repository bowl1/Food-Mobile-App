import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, initializeAuth } from 'firebase/auth';
import { Platform } from 'react-native';

import {
  AUTH_EMULATOR_HOST,
  AUTH_EMULATOR_PORT,
  FIREBASE_CONFIG,
  USE_AUTH_EMULATOR,
} from '@/config/env';

const app = initializeApp(FIREBASE_CONFIG);
const { getReactNativePersistence } = require('@firebase/auth/dist/rn/index.js') as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => unknown;
};

export const auth =
  Platform.OS === 'web'
    ? getAuth(app)
    : initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage) as any,
      });

let emulatorConnected = false;

export function setupFirebaseAuthEmulator() {
  if (!USE_AUTH_EMULATOR || emulatorConnected) {
    return;
  }

  connectAuthEmulator(auth, `http://${AUTH_EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`);
  emulatorConnected = true;
}
