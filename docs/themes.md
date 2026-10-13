# Themes

A theme changes the colours and artwork only; it never changes how the game plays. Players pick one on the **Customise** screen (the choice is kept on that device).

Themes live in `src/game/themes.ts`: the five route colours, the wall and crash-pad colours, the menu title and grade-button colours, and optional artwork.

## Umbraco

- `public/themes/umbraco-logo.svg` is the Umbraco logo with its fill changed to white, so the game can tint it (`logo.tint`, Umbraco pink). It shows beside the title on the menu.
- `public/themes/umbraco-mvp.svg` is the Umbraco MVP Summit logomark in its own colours. It shows above "SENT!" when a route is sent.

Check the usage terms at https://umbraco.com/about-us/press/ before changing or adding artwork.

## Adding artwork to a theme

- `logo`: a single-colour SVG drawn in **white**; the game tints it. Give the SVG `width`/`height` attributes.
- `badge`: a full-colour SVG, drawn as it is.
- Keep files small: they are loaded at start-up.
