# Combat baseline comparison

Status: Step 2.5 complete.

This ledger converts the completed formula comparison into project-owned,
static behavior. It records equations and observable outcomes only: no outside
source code, package, network call, adapter, generated import, or runtime lookup
is part of the combat module.

## Resolution policy

- An `accepted` row is part of the new engine baseline.
- A `product rule` row intentionally follows Tacet Lab's explicit behavior.
- A `deferred` row must return `unsupported-mechanic`; it may not guess.
- Executable coverage must cross the combat module's public interface and reuse
  the stable fixture IDs from [`FIXTURES.md`](./FIXTURES.md).

## Formula coverage

| Behavior | Rules | Fixtures | Outcome |
| --- | --- | --- | --- |
| Base and final HP, ATK, and DEF aggregation | `STAT-001`–`STAT-003` | `F01`–`F03` | accepted |
| ATK, HP, DEF, hybrid, and Energy Regen scaling | `CLASS-006`–`CLASS-009` | `F04`–`F08` | accepted |
| One calculation per real hit | `DMG-004` | `F09` | accepted |
| Preserve calculation precision and round only for display | `DMG-005`, rounding policy | `F01`–`F22` | accepted |
| Normal, critical, and expected results | `CRIT-001`–`CRIT-004` | `F10` | accepted |
| Additive ordinary damage-bonus bucket | `DMG-001` | `F11` | accepted |
| Separate amplification factor | `DMG-002` | `F12` | accepted |
| Separate vulnerability and final-damage factors | `DMG-009`, `EFFECT-009` | `F13` | accepted |
| Generic raw flat damage on an ordinary hit | `DMG-008` | `F14` | deferred |
| Level-based defence | `DEF-001` | `F15` | accepted |
| Separate defence-reduction and defence-ignore buckets | `DEF-002`, `DEF-003` | `F16` | accepted |
| Negative, ordinary, and high resistance | `RES-001`–`RES-005` | `F17`, `F18` | accepted |
| Enemy damage-reduction operations | `DMG-003`, `DR-001`, `DR-003` | `F19` | deferred |
| Fixed damage bypasses ordinary damage factors and crit | `DMG-010`, `CRIT-004` | `F20` | accepted |
| Healing from scaling, flat value, and healing bonus | `HEAL-001` | `F21` | accepted |
| Shield strength from scaling, flat value, and shield bonus | `SHIELD-001` | `F22` | accepted |
| Unknown formula families fail closed | `REP-006` | `F23` | accepted |

## Boundary decisions

| Boundary | Accepted behavior |
| --- | --- |
| Crit. Rate below `0` or above `1` | Clamp to `[0, 1]` |
| Displayed Crit. DMG `150%` | Internal multiplier `1.50` |
| Energy Regen `150%` | Use `150` percentage points for ER-scaling actions |
| Defence reduction plus ignore | Sum within separate buckets, then multiply the two bucket factors |
| Defence over-reduction | Apply the equation without an extra clamp |
| Resistance with no reduction | Use the standard negative, ordinary, or high-resistance branch |
| Resistance already below zero | Further reduction contributes at half strength |
| Positive resistance crossed below zero | Only the excess below zero contributes at half strength |
| Base resistance exactly `100%` | High-resistance multiplier `1 / 6` |
| Multi-hit totals | Sum full-precision hit values; round the displayed total up |
| Expected damage | Apply crit expectation to the unrounded pre-crit hit and preserve precision |

## Completion gate

- Every supported Step 2 formula maps to an independent fixture.
- Comparison disagreements are resolved as either a product rule or a deferred
  mechanic; none remain ambiguous.
- No external calculator identifier or integration is part of the project.
- Step 3 implements the accepted rows above through the public combat seam.
