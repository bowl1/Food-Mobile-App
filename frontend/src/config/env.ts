import { Platform } from 'react-native';

const fallbackApiBaseUrl =
  Platform.OS === 'android' ? 'http://10.0.2.2:5001' : 'http://localhost:5001';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? fallbackApiBaseUrl;

export const FIREBASE_CONFIG = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyAcD5vIhcZOR_CPsM3d3vkwrZ5teiZd7xE',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'recipe-8fbff.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'recipe-8fbff',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'recipe-8fbff.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '605774693006',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '1:605774693006:android:b522a55bd52492ff30ffdf',
};

export const USE_AUTH_EMULATOR = process.env.EXPO_PUBLIC_USE_AUTH_EMULATOR === '1';
export const AUTH_EMULATOR_HOST = process.env.EXPO_PUBLIC_AUTH_EMULATOR_HOST ?? '127.0.0.1';
export const AUTH_EMULATOR_PORT = Number(process.env.EXPO_PUBLIC_AUTH_EMULATOR_PORT ?? '9099');
