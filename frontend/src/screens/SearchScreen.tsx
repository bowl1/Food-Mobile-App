import { useQuery } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { searchRecipes } from '@/services/api';
import { RootStackParamList } from '@/navigation/types';
import { useFilterStore } from '@/store/filterStore';
import { Recipe } from '@/types/recipe';
import { recipeImage } from '@/utils/recipe';
import { NavigationProp } from '@react-navigation/native';

export function SearchScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const selectedTag = useFilterStore((state) => state.selectedTag);
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');

  const recipesQuery = useQuery({
    queryKey: ['recipes', submittedKeyword, selectedTag],
    queryFn: () => searchRecipes(submittedKeyword, selectedTag),
    enabled: submittedKeyword.length > 0,
  });

  const submitSearch = async (value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      Alert.alert('Notice', 'Please enter an ingredient keyword.');
      return;
    }
    setSubmittedKeyword(normalized);
  };

  const message = useMemo(() => {
    if (!submittedKeyword) {
      return 'Enter ingredients from your fridge to start searching.';
    }
    if (recipesQuery.isLoading) {
      return 'Searching...';
    }
    if (recipesQuery.error) {
      return String(recipesQuery.error);
    }
    return `Found ${recipesQuery.data?.length ?? 0} recipes`;
  }, [recipesQuery.data?.length, recipesQuery.error, recipesQuery.isLoading, submittedKeyword]);

  const renderRecipe = ({ item }: { item: Recipe }) => (
    <Pressable style={styles.card} onPress={() => navigation.navigate('RecipeDetail', { recipe: item })}>
      {recipeImage(item) ? <Image source={{ uri: recipeImage(item) }} style={styles.thumb} /> : <View style={styles.thumb} />}
      <View style={styles.cardText}>
        <Text style={styles.recipeName}>{item.name ?? 'No Name'}</Text>
        <Text style={styles.recipeTags}>{(item.tags ?? []).join(', ') || 'No tags'}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TextInput
          style={styles.input}
          placeholder="Enter an ingredient, e.g. chicken"
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={() => submitSearch(keyword)}
        />
        <Pressable style={styles.searchBtn} onPress={() => submitSearch(keyword)}>
          <Text style={styles.searchBtnText}>Search</Text>
        </Pressable>
      </View>

      <View style={styles.toolsRow}>
        <Pressable style={styles.filterBtn} onPress={() => navigation.navigate('Filter')}>
          <Text style={styles.filterBtnText}>{selectedTag || 'Filter'}</Text>
        </Pressable>
        <Text style={styles.message}>{message}</Text>
      </View>

      <FlatList
        data={recipesQuery.data ?? []}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={renderRecipe}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2FAF5',
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#9CCBAF',
    borderRadius: 10,
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchBtn: {
    backgroundColor: '#1D6F42',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  searchBtnText: {
    color: '#FFF',
    fontWeight: '700',
  },
  toolsRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterBtn: {
    borderWidth: 1,
    borderColor: '#2E8A54',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#E4F3EA',
  },
  filterBtnText: {
    color: '#1D6F42',
    fontWeight: '600',
  },
  message: {
    color: '#28553A',
    flex: 1,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 20,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E2EFE7',
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: '#D7E8DE',
  },
  cardText: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  recipeName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1D6F42',
  },
  recipeTags: {
    color: '#597D68',
  },
});
