# UI stylesheet ownership

`../styles.css` is the single ordered manifest for styles that were previously
kept in the global stylesheet. Its import order is part of the cascade and must
not be alphabetized.

- `core/` owns design tokens, shared primitives, controls, and cross-page
  responsive rules.
- `shell/` owns the application frame, navigation, top bar, and footer.
- Page and feature folders own their layouts and responsive overrides.
- A page can have more than one partial when later rules intentionally override
  its base styles. Keep new rules in the narrowest existing owner.

Some established component stylesheets still live beside their React
components, including `character-showcase.css`, `home-view.css`, and
`team-workspace.css`. They should remain component-owned rather than being
folded back into the global manifest.
