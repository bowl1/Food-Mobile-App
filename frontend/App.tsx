import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FridgeChef } from './src/fridgechef/FridgeChef';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15000 } } });
export default function App() {
  return <SafeAreaProvider><QueryClientProvider client={queryClient}><StatusBar style="dark" /><FridgeChef /></QueryClientProvider></SafeAreaProvider>;
}
