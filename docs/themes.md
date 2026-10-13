# Themes

A theme changes the colours and artwork only; it never changes how the game plays. Players pick one on the **Customise** screen (the choice is kept on that device).

Themes live in `src/game/themes.ts`: the five route colours, the wall and crash-pad colours, the menu title and grade-button colours, and optional artwork.

## Umbraco

- `public/themes/umbraco-mark.svg` is the Umbraco logo's circular mark (white). Every route hold is drawn as a disc in its route colour with the mark's U in white (`holdMark`, `BootScene.makeMarkHold`). Because they are all discs, the colours are the only cue to tell the holds apart, so the five colours are kept clearly different.
- `public/themes/umbraco-mvp.svg` is the Umbraco MVP Summit logomark in its own colours. It shows above "SENT!" when a route is sent.

Check the usage terms at https://umbraco.com/about-us/press/ before changing or adding artwork.

## Adding artwork to a theme

- `holdMark`: a single-colour SVG drawn in **white** (a disc with a symbol cut out); the game colours it for each hold. Give the SVG `width`/`height` attributes.
- `badge`: a full-colour SVG, drawn as it is.
- Keep files small: they are loaded at start-up.
