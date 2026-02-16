import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { loadFavoritesFromSQLite, syncFavorites, toggleFavorite } from '@/db/favorites';
import { notifyFavoriteSaved } from '@/services/notifications';
import { RootStackParamList } from '@/navigation/types';
import { Recipe } from '@/types/recipe';
import { recipeImage } from '@/utils/recipe';

type Props = NativeStackScreenProps<RootStackParamList, 'RecipeDetail'>;

export function RecipeDetailScreen({ route }: Props) {
  const recipe = route.params.recipe;
  const queryClient = useQueryClient();
  const contentRef = React.useRef<View | null>(null);
  const favoritesQuery = useQuery({
    queryKey: ['favorites'],
    queryFn: loadFavoritesFromSQLite,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24 * 7,
  });
  const favorites = favoritesQuery.data ?? [];

  React.useEffect(() => {
    void (async () => {
      try {
        await syncFavorites();
        await queryClient.invalidateQueries({ queryKey: ['favorites'] });
      } catch (error) {
        console.warn('Background sync favorites failed:', error);
      }
    })();
  }, [queryClient]);

  const isFavorite = useMemo(
    () => favorites.some((favoriteRecipe) => favoriteRecipe.id === recipe.id),
    [favorites, recipe.id],
  );

  const addFavoriteMutation = useMutation({
    mutationFn: () => toggleFavorite(recipe),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['favorites'] });
      const previousFavorites = queryClient.getQueryData<Recipe[]>(['favorites']) ?? [];
      const alreadyExists = previousFavorites.some((favoriteRecipe) => favoriteRecipe.id === recipe.id);

      if (!alreadyExists) {
        queryClient.setQueryData<Recipe[]>(['favorites'], [...previousFavorites, recipe]);
      } else {
        queryClient.setQueryData<Recipe[]>(
          ['favorites'],
          previousFavorites.filter((favoriteRecipe) => favoriteRecipe.id !== recipe.id),
        );
      }

      return { previousFavorites };
    },
    onSuccess: (result) => {
      if (result.isFavorite) {
        void notifyFavoriteSaved(recipe.name ?? 'Recipe');
      }
      Alert.alert('Success', result.isFavorite ? 'Added to favorites' : 'Removed from favorites');
    },
    onError: (error, _variables, context) => {
      if (context?.previousFavorites) {
        queryClient.setQueryData(['favorites'], context.previousFavorites);
      }
      Alert.alert('Favorite action failed', String(error));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['favorites'] });
      void syncFavorites().finally(() => {
        void queryClient.invalidateQueries({ queryKey: ['favorites'] });
      });
    },
  });

  const shareRecipe = async () => {
    try {
      if (!contentRef.current) {
        throw new Error('View is not ready');
      }
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        throw new Error('Sharing is not available on this device');
      }

      const imageUri = await captureRef(contentRef, {
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
      });
      await Sharing.shareAsync(imageUri, {
        mimeType: 'image/jpeg',
        dialogTitle: recipe.name ?? 'Share Recipe',
        UTI: 'public.jpeg',
      });
    } catch (error) {
      Alert.alert('Share failed', String(error));
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View ref={contentRef} collapsable={false} style={styles.shareCanvas}>
        {recipeImage(recipe) ? <Image source={{ uri: recipeImage(recipe) }} style={styles.image} /> : <View style={styles.image} />}
        <Text style={styles.title}>{recipe.name ?? 'Recipe Detail'}</Text>

        <Pressable
          style={[styles.favoriteButton, addFavoriteMutation.isPending && styles.favoriteButtonDisabled]}
          onPress={() => addFavoriteMutation.mutate()}
          disabled={addFavoriteMutation.isPending}
        >
          <Text style={styles.favoriteText}>
            {addFavoriteMutation.isPending ? 'Saving...' : isFavorite ? 'Remove Favorite' : 'Add to Favorites'}
          </Text>
        </Pressable>

        <Pressable style={styles.shareButton} onPress={shareRecipe}>
          <Text style={styles.shareText}>Share Recipe</Text>
        </Pressable>

        <Text style={styles.section}>Ingredients</Text>
        {(recipe.ingredients ?? []).map((ingredient, index) => (
          <Text key={`${ingredient.name}-${index}`} style={styles.line}>
            - {ingredient.name}
          </Text>
        ))}

        <Text style={styles.section}>Steps</Text>
        {(recipe.steps ?? []).map((step, index) => (
          <Text key={`${step}-${index}`} style={styles.line}>
            {index + 1}. {step}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2FAF5',
  },
  content: {
    padding: 16,
    paddingBottom: 28,
  },
  shareCanvas: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
  },
  image: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    backgroundColor: '#D7E8DE',
  },
  title: {
    marginTop: 14,
    fontSize: 24,
    fontWeight: '700',
    color: '#1D6F42',
  },
  favoriteButton: {
    marginTop: 12,
    backgroundColor: '#1D6F42',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
  },
  favoriteButtonDisabled: {
    opacity: 0.7,
  },
  favoriteText: {
    color: '#FFF',
    fontWeight: '700',
  },
  shareButton: {
    marginTop: 10,
    backgroundColor: '#2E8A54',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
  },
  shareText: {
    color: '#FFF',
    fontWeight: '700',
  },
  section: {
    marginTop: 18,
    fontSize: 18,
    fontWeight: '700',
    color: '#1D6F42',
  },
  line: {
    marginTop: 6,
    color: '#294A35',
    lineHeight: 21,
  },
});
