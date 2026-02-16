export type RecipeIngredient = {
  name: string;
};

export type Recipe = {
  id: string;
  name: string;
  image?: string;
  thumbnail?: string;
  tags?: string[];
  ingredients?: RecipeIngredient[];
  steps?: string[];
};

export type UserProfile = {
  username?: string;
  avatar?: string;
};
