import { create } from 'zustand';

type FilterState = {
  selectedTag: string;
  setSelectedTag: (tag: string) => void;
};

export const filterTags = ['', 'vegetarian', 'keto', 'peanut-free', 'egg-free', 'pork-free', 'gluten-free'];

export const useFilterStore = create<FilterState>((set) => ({
  selectedTag: '',
  setSelectedTag: (selectedTag) => set({ selectedTag }),
}));
