import { Recipe } from '@/types/recipe';

export type MainTabParamList = {
  Search: undefined;
  Favorites: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  MainTabs: undefined;
  Filter: undefined;
  RecipeDetail: { recipe: Recipe };
};
