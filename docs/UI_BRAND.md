# FridgeChef illustration direction

The original `frontend/assets/logo.png` is retained as a source reference; `frontend/assets/logo-handdrawn.png` is now the brand mark. UI colors follow its orange bowl, cream background and dark green leaf outlines. Buttons use a darker orange for readable white labels; navigation and ingredient icons use food and cooking motifs. Paper colors, serif headings, rounded tiles and larger recipe imagery carry through login, Kitchen, Recipes, History, preferences and modal sheets.

`frontend/assets/kitchen-illustration.png` was generated with the built-in imagegen tool using the existing logo as a style reference. It appears as decorative artwork on login and Kitchen. Recipe placeholders explicitly say “Kitchen illustration”; recipe-specific AI images retain their own label and replace the decorative placeholder when ready. The subsequent all-app hand-drawn theme uses `kitchen-handdrawn.png` for login, Kitchen and recipe placeholders. New recipe-image prompts request watercolor and colored-pencil artwork with the same palette and paper texture. Existing stored recipe images are reused; no paid regeneration is triggered. Recipe data and ownership behavior are unchanged.

## Asset prompt

Use case: illustration-story. Create a NEW wide hero illustration for the FridgeChef mobile app, using the attached existing logo ONLY as a visual style reference. Do not redesign the logo. Landscape 3:2 composition, no text. Warm appetite-inducing editorial gouache and risograph food illustration with visible fine paper grain, deep inky forest-green outlines, rich tomato red, roasted orange, golden egg yolk, bright leafy greens, cream highlights. A generous orange ceramic bowl filled with a delicious cooked vegetable and egg meal, juicy tomato wedges, golden roasted vegetables, fresh herbs, steam curls; a few loose ingredients and hand-drawn little sparkles around the bowl. Artistic rather than photorealistic. Elegant simple composition with generous warm cream #FFF6DF background and all objects fully inside frame. Keep bold organic shapes and tactile shading matching the reference. No letters, no UI, no watermark, no collage, no border.

## Verification

- Frontend TypeScript check and web export.
- 390 × 844 browser preview with an isolated local demo database; ingredient modal, Kitchen, Recipes, History and preferences.
- Existing app icon retained; splash and Android background aligned to paper palette; web favicon uses the logo. Native icon/splash changes require a rebuilt app binary.

## All-app hand-drawn theme

`SketchPaper.tsx` provides lightweight paper grain and irregular pencil frames. Cards, input fields and sheets use softly asymmetric corners; dividers resemble pencil dashes. Preferences, notices, confirmation actions, navigation, loading and empty states use the same hand-drawn icon family. Shared branded artwork comes from `kitchen-handdrawn.png`. The hand-drawn logo preserves the original bowl-and-leaves identity and is used for the app icon, splash, favicon and in-app branding.
