# Themes

A theme changes the colours and artwork only; it never changes how the game plays. Players pick one on the **Customise** screen (the choice is kept on that device).

Themes live in `src/game/themes.ts`: the five route colours, the wall and crash-pad colours, the menu title and grade-button colours, and an optional logo.

## The Umbraco logo

`public/themes/umbraco-logo.svg` is a **placeholder ring**. Replace it with the official artwork from https://umbraco.com/about-us/press/ and check the usage terms there first.

- Use a single-colour mark drawn in **white**. The game tints it (`logo.tint` in `themes.ts`), so the same file works on any colour.
- Keep the file small; it is loaded at start-up.
- The logo is shown on the menu beside the title (`MenuScene.logo`), scaled to 54 px.
