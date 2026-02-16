import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Platform } from 'react-native';

import { LoadingScreen } from '@/components/LoadingScreen';
import { useAuthStore } from '@/store/authStore';
import { AuthScreen } from '@/screens/AuthScreen';
import { FavoritesScreen } from '@/screens/FavoritesScreen';
import { FilterScreen } from '@/screens/FilterScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { RecipeDetailScreen } from '@/screens/RecipeDetailScreen';
import { SearchScreen } from '@/screens/SearchScreen';
import { MainTabParamList, RootStackParamList } from '@/navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: '#1D6F42' },
        headerTintColor: '#fff',
        tabBarActiveTintColor: '#1D6F42',
        tabBarInactiveTintColor: '#7A9385',
        tabBarShowLabel: true,
        tabBarStyle: {
          height: Platform.OS === 'ios' ? 84 : 70,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 20 : 10,
          backgroundColor: '#FFFFFF',
          borderTopWidth: 0,
          elevation: 12,
          shadowColor: '#163B25',
          shadowOpacity: 0.12,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -2 },
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        tabBarIcon: ({ color, size, focused }) => {
          let iconName: React.ComponentProps<typeof Ionicons>['name'] = 'ellipse';
          if (route.name === 'Search') {
            iconName = focused ? 'search' : 'search-outline';
          } else if (route.name === 'Favorites') {
            iconName = focused ? 'heart' : 'heart-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          }

          return <Ionicons name={iconName} size={size + 2} color={color} />;
        },
      })}
    >
      <Tabs.Screen
        name="Search"
        component={SearchScreen}
        options={{ headerTitle: 'Fridge to Food', tabBarLabel: 'Search' }}
      />
      <Tabs.Screen name="Favorites" component={FavoritesScreen} options={{ headerTitle: 'Favorites', tabBarLabel: 'Saved' }} />
      <Tabs.Screen name="Profile" component={ProfileScreen} options={{ headerTitle: 'My Profile', tabBarLabel: 'Profile' }} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const user = useAuthStore((state) => state.user);
  const ready = useAuthStore((state) => state.ready);

  if (!ready) {
    return <LoadingScreen label="Authenticating..." />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1D6F42' },
          headerTintColor: '#fff',
        }}
      >
        {user ? (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="Filter" component={FilterScreen} options={{ title: 'Filter' }} />
            <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} options={{ title: 'Recipe Detail' }} />
          </>
        ) : (
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
