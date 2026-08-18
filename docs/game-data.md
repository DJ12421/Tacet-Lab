# Game Data Verification

## Current status

The formula engine is pinned to `nanoka-3.6-formula-v2` and the generated Nanoka 3.6 catalog. All 62 characters, 122 weapons, 34 Sonatas, and 181 Echoes are classified by the coverage registry. Character attack targets are evaluated from the structured skill parameters in that dataset.

The result sheet visibly labels its provenance as Nanoka-derived. That makes calculations reproducible from the pinned source, but does not mean they were independently verified against the current English in-game UI. Keep that distinction visible until the verification checklist is complete.

## Verification checklist

For Spectro Rover, Chixia, Baizhi, and each representative weapon:

1. Record the game version and verification date.
2. Capture English level-90 base HP, ATK, DEF, Crit. Rate, and Crit. DMG.
3. Capture weapon level-90 base ATK and secondary stat.
4. Capture each supported attack at Forte level 10, including whether the displayed percentage is per hit or total.
5. Record Sonata trigger conditions, stack rules, duration, target, and displayed bonus.
6. Validate normal and critical output against a target with known level and resistance.
7. Add or update a hand-calculated test fixture before changing checked-in values.

Do not use leaked or unreleased content. GPL-derived implementation or data may be incorporated only while the whole distributed project remains GPL-compatible and preserves the required source, license, attribution, and modification notices. External sources require explicit approval and compatible redistribution terms.

## Rounding

Calculations retain floating-point precision internally. Formatting rounds only at the display boundary. A fixture passes when it matches the game-displayed integer under the documented game rounding behavior; broad percentage tolerances must not be used to conceal formula errors.
