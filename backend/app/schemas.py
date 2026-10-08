from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class InventoryInput(StrictModel):
    food_name: str = Field(min_length=1, max_length=80)
    quantity: float = Field(gt=0, le=100000)
    unit: str = Field(default='piece', min_length=1, max_length=30)
    source: Literal['manual', 'image_recognition'] = 'manual'


class InventoryPatch(StrictModel):
    food_name: str | None = Field(default=None, min_length=1, max_length=80)
    quantity: float | None = Field(default=None, gt=0, le=100000)
    unit: str | None = Field(default=None, min_length=1, max_length=30)
    consumed: bool | None = None


class Preferences(StrictModel):
    vegetarian: bool = False
    vegan: bool = False
    keto: bool = False
    gluten_free: bool = False
    dairy_free: bool = False
    high_protein: bool = False
    max_cooking_time: int = Field(default=30, ge=5, le=180)


class Ingredient(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    quantity: float = Field(gt=0, le=100000)
    unit: str = Field(min_length=1, max_length=30)


class Recipe(StrictModel):
    recipe_name: str = Field(min_length=1, max_length=120)
    ingredients: list[Ingredient] = Field(min_length=1, max_length=30)
    pantry_staples: list[str] = Field(default_factory=list, max_length=4)
    cooking_time_minutes: int = Field(gt=0, le=180)
    dietary_tags: list[str] = Field(default_factory=list, max_length=10)
    steps: list[str] = Field(min_length=2, max_length=20)
    reason: str = Field(min_length=1, max_length=500)


class Candidates(StrictModel):
    recipes: list[Recipe] = Field(max_length=5)


class Evaluation(StrictModel):
    inventory_utilization: float = Field(ge=0, le=1)
    dietary_fit: float = Field(ge=0, le=1)
    recipe_feasibility: float = Field(ge=0, le=1)
    cooking_time_fit: float = Field(ge=0, le=1)
    instruction_quality: float = Field(ge=0, le=1)
    overall_score: float = Field(ge=0, le=1)


class DetectedFood(InventoryInput):
    confidence: float = Field(ge=0, le=1)


class Recognition(StrictModel):
    foods: list[DetectedFood] = Field(max_length=40)


class ImageInput(StrictModel):
    image_base64: str = Field(min_length=1, max_length=14000000)
    mime_type: Literal['image/jpeg', 'image/png', 'image/webp'] = 'image/jpeg'
