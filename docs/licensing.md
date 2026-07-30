# Licensing and calculation provenance

Tacet Lab is distributed under GPL-3.0-only. The complete license is in the
repository root.

The Calculation V2 implementation adapts GPL-licensed calculation behavior and
mechanic definitions from WutheringTools. Imports are pinned to a reviewed
upstream Git revision so deployed calculation data can be traced to an exact
source state.

## Pinned calculation source

- Repository: https://github.com/ryanbenson/wuthering-waves-optimizer
- Revision: `c957c5250f83df6d53dd55e97e867ec6c23bbade`
- Upstream license: GPL-3.0
- Local integration: React/TypeScript domain modules and generated static data

Generated calculation data must include the upstream revision and generation
timestamp. Updating the pinned revision requires reviewing new modifier types,
special handlers, and data-shape changes before regenerating the catalog.

Tacet Lab continues to source display metadata and artwork through its existing
catalog pipeline. The calculation import must not copy WutheringTools branding
or hosted artwork.
