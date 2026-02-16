import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationProp, useNavigation } from '@react-navigation/native';

import { loadFavoritesFromSQLite, syncFavorites, toggleFavorite } from '@/db/favorites';
import { RootStackParamList } from '@/navigation/types';
import { Recipe } from '@/types/recipe';
import { recipeImage } from '@/utils/recipe';

export function FavoritesScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const favoritesQuery = useQuery({
    queryKey: ['favorites'],
    queryFn: loadFavoritesFromSQLite,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24 * 7,
  });

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await syncFavorites();
        if (mounted) {
          await queryClient.invalidateQueries({ queryKey: ['favorites'] });
        }
      } catch (error) {
        console.warn('Background sync favorites failed:', error);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [queryClient]);

  const removeMutation = useMutation({
    mutationFn: async (recipe: Recipe) => {
      await toggleFavorite(recipe);
    },
    onMutate: async (targetRecipe) => {
      await queryClient.cancelQueries({ queryKey: ['favorites'] });
      const previousFavorites = queryClient.getQueryData<Recipe[]>(['favorites']) ?? [];

      queryClient.setQueryData<Recipe[]>(
        ['favorites'],
        previousFavorites.filter((recipe) => recipe.id !== targetRecipe.id),
      );

      return { previousFavorites };
    },
    onError: (error, _recipe, context) => {
      if (context?.previousFavorites) {
        queryClient.setQueryData(['favorites'], context.previousFavorites);
      }
      Alert.alert('Delete failed', String(error));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['favorites'] });
      void syncFavorites().finally(() => {
        void queryClient.invalidateQueries({ queryKey: ['favorites'] });
      });
    },
  });

  const renderItem = ({ item }: { item: Recipe }) => (
    <View style={styles.card}>
      {recipeImage(item) ? <Image source={{ uri: recipeImage(item) }} style={styles.thumb} /> : <View style={styles.thumb} />}
      <Pressable style={styles.info} onPress={() => navigation.navigate('RecipeDetail', { recipe: item })}>
        <Text style={styles.name}>{item.name ?? 'No Name'}</Text>
      </Pressable>
      <Pressable
        style={[styles.deleteBtn, removeMutation.isPending && styles.deleteBtnDisabled]}
        onPress={() => removeMutation.mutate(item)}
        disabled={removeMutation.isPending}
      >
        <Text style={styles.deleteText}>{removeMutation.isPending ? 'Deleting...' : 'Delete'}</Text>
      </Pressable>
    </View>
  );

  if (favoritesQuery.isLoading) {
    return (
      <View style={styles.emptyWrap}>
        <Text>Loading...</Text>
      </View>
    );
  }

  if (favoritesQuery.error) {
    return (
      <View style={styles.emptyWrap}>
        <Text>{String(favoritesQuery.error)}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={favoritesQuery.data ?? []}
      keyExtractor={(item, index) => `${item.id}-${index}`}
      renderItem={renderItem}
      ListEmptyComponent={<Text style={styles.empty}>No favorite recipes yet.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2FAF5',
  },
  content: {
    padding: 14,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#DBECE3',
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#D7E8DE',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1D6F42',
  },
  deleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#B93C2D',
  },
  deleteText: {
    color: '#FFF',
    fontWeight: '700',
  },
  deleteBtnDisabled: {
    opacity: 0.7,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2FAF5',
  },
  empty: {
    textAlign: 'center',
    color: '#4C6D59',
    marginTop: 30,
  },
});
