import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RootStackParamList } from '@/navigation/types';
import { filterTags, useFilterStore } from '@/store/filterStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Filter'>;

export function FilterScreen({ navigation }: Props) {
  const selectedTag = useFilterStore((state) => state.selectedTag);
  const setSelectedTag = useFilterStore((state) => state.setSelectedTag);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Filter Recipes</Text>
      {filterTags.map((tag) => {
        const active = tag === selectedTag;
        return (
          <Pressable
            key={tag || 'all'}
            style={[styles.option, active && styles.optionActive]}
            onPress={() => {
              setSelectedTag(tag);
              navigation.goBack();
            }}
          >
            <Text style={[styles.optionText, active && styles.optionTextActive]}>{tag || 'Reset'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2FAF5',
    padding: 16,
    gap: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1D6F42',
    marginBottom: 4,
  },
  option: {
    paddingVertical: 12,
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#D9E9E0',
  },
  optionActive: {
    backgroundColor: '#1D6F42',
    borderColor: '#1D6F42',
  },
  optionText: {
    color: '#2D6145',
    fontSize: 16,
  },
  optionTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
});
