# Combat calculation rules and baseline ledger

Status: Step 1 baseline for the clean-room combat module.

This document defines the accepted calculation behavior that may be turned into
fixtures and implementation. Step 2.5 converted the supported formula choices
into a static project baseline.

Existing Tacet Lab calculators are recorded only as legacy implementations to
delete. Their results and tests are not evidence for this document.

## Rule statuses

| Status | Meaning | May enter fixtures? |
| --- | --- | --- |
| `baseline` | Accepted calculation behavior recorded by Step 2.5 | Yes |
| `design` | A Tacet Lab interface or determinism decision | Yes |
| `user-rule` | Explicit product direction that overrides the comparison baseline | Yes |
| `deferred` | Not sufficiently specified for implementation | No |

The baseline is project-owned static data and equations. The combat module must
not contact, import, execute, or depend on another calculator at runtime.

## Units and representation

| Rule | Status | Decision |
| --- | --- | --- |
| `REP-001` | `design` | Percentages are decimal ratios internally: `20%` is `0.20`. |
| `REP-002` | `design` | Durations and timestamps are seconds and may be fractional. |
| `REP-003` | `design` | IDs are opaque strings and are never parsed as numbers. |
| `REP-004` | `design` | Registry and request inputs are immutable. |
| `REP-005` | `design` | Formula evaluation must not depend on locale, current time, randomness, DOM, storage, network, or iteration order of unrelated records. |
| `REP-006` | `design` | Invalid finite numbers, missing IDs, stale data versions, and contradictory selections fail closed. |
| `REP-007` | `design` | UI formatting is not calculation and stays outside the combat module. |

## Classification model

An action has separate axes. They must not be collapsed into one string.

### Result kind

- `damage`
- `healing`
- `shield`

### Damage type

- `basic`
- `heavy`
- `skill`
- `liberation`
- `intro`
- `outro`
- `echo`
- `tune-break`

Healing and shield actions have no damage type. `intro`, `outro`, and `skill`
are distinct and never inherit one another's bonuses unless a reviewed mechanic
explicitly says so.

### Element

- `spectro`
- `fusion`
- `glacio`
- `electro`
- `aero`
- `havoc`
- `none` for a non-elemental result where applicable

### Scaling

An ordinary action has a reviewed scaling vector rather than one exclusive
scaling label:

```text
scaling power = final ATK * ATK ratio
              + final HP * HP ratio
              + final DEF * DEF ratio
              + Energy Regen percentage points * Energy Regen ratio
```

Most actions have exactly one non-zero ratio. The vector also represents real
hybrid-scaling mechanics without adding a separate formula path. Fixed damage
is a distinct action formula and does not pretend to scale with a combat stat.
Energy Regen remains a decimal ratio in aggregated stats, but a reviewed action
that scales from it uses displayed percentage points: internal `1.50` becomes
`150` for the scaling term.

### Tags

Tags provide additional filtering without replacing the damage type:

- `coordinated`
- `forte`
- `normal-chain`
- `dodge-counter`
- `mid-air`
- `plunge`
- `off-field`
- `summon`
- Additional reviewed tags only when a real mechanic needs them

For example, a coordinated attack can still deal Resonance Skill DMG. `Forte`
describes where an action comes from, while its reviewed damage type determines
which damage bonus applies.

| Rule | Status | Decision |
| --- | --- | --- |
| `CLASS-001` | `user-rule` | Intro, Outro, and Resonance Skill are separate damage types. |
| `CLASS-002` | `design` | An action has one result kind and at most one damage type. |
| `CLASS-003` | `design` | Coordinated, Forte, and similar concepts are tags, not replacement damage types. |
| `CLASS-004` | `design` | Classification is reviewed registry data; names and descriptions are not classified at runtime. |
| `CLASS-005` | `design` | An effect applies only when its reviewed type, element, action, or tag filters match. |
| `CLASS-006` | `baseline` | Scaling may use ATK, HP, DEF, or Energy Regen. |
| `CLASS-007` | `baseline` | Fixed damage is a separate formula family that does not crit or use ordinary damage multipliers. |
| `CLASS-008` | `design` | The new module represents scaling as a vector so a reviewed hybrid action needs no second formula path. |
| `CLASS-009` | `baseline` | Energy-Regen-scaling formulas use displayed percentage points, so internal `1.50` contributes `150` before its scaling ratio. |

## Stat aggregation

The registry supplies level-resolved character and weapon values. How source
curves produce those values is a separate game-data concern and must itself be
source-labelled.

For HP and DEF:

```text
base = floor(character base at selected level)
final = base * (1 + sum applicable percent bonuses) + sum flat bonuses
```

For ATK:

```text
base = floor(character ATK at selected level)
     + floor(weapon ATK at selected level)

final = base * (1 + sum applicable ATK percent bonuses)
             + sum flat ATK bonuses
```

Passive and conditional modifiers enter the same appropriate flat or percentage
bucket after eligibility has been resolved. A percentage ATK effect applies to
base ATK, not to already calculated final ATK.

| Rule | Status | Decision |
| --- | --- | --- |
| `STAT-001` | `reference-parity` | Computed base HP, ATK, and DEF round down; final stats retain precision for calculations and are rounded only for display. |
| `STAT-002` | `baseline` | Weapon base ATK joins character base ATK before ATK percentage bonuses. |
| `STAT-003` | `baseline` | Flat HP, ATK, and DEF are added after the base-stat percentage multiplication. |
| `STAT-004` | `design` | Crit, Energy Regen, damage bonus, healing bonus, and similar ratios remain ratios and are not integer-rounded during aggregation. |
| `STAT-005` | `design` | Always-equipped effects are active without a selectable toggle. |
| `STAT-006` | `design` | Mutually exclusive modes cannot contribute simultaneously. |
| `STAT-007` | `baseline` | The engine consumes level-resolved registry values exactly as supplied; curve generation remains a game-data concern. |

## Damage formula

The engine evaluates each hit independently. For one hit:

```text
scaling power = sum of each final scaling stat * its reviewed scaling ratio

base hit = scaling power * hit motion value + reviewed flat damage

bonus factor = max(0, 1
  + matching damage-type bonuses
  + matching elemental bonuses
  + matching action-specific bonuses
  + matching generic damage bonuses)

amplify factor = max(0, 1 + sum matching amplification values)

vulnerability factor = max(0, 1 + sum matching enemy vulnerability values)

final-damage factor = max(0, 1 + sum matching final-damage values)

pre-crit hit = base hit
  * bonus factor
  * amplify factor
  * vulnerability factor
  * final-damage factor
  * defense multiplier
  * resistance multiplier
  * damage-reduction factor

normal hit = pre-crit hit
critical hit = pre-crit hit * critical-damage multiplier

expected hit =
  pre-crit hit * (1 + effective critical rate
    * (critical-damage multiplier - 1))
```

Action totals are sums of full-precision hit results. A multi-hit line stores one
motion value per real hit. `40% * 3 + 80%` remains four hits so hit-level traces
and effects retain their real structure.

| Rule | Status | Decision |
| --- | --- | --- |
| `DMG-001` | `baseline` | Matching generic, elemental, action-specific, and damage-type bonuses share one additive bonus bucket. |
| `DMG-002` | `baseline` | Amplification/deepen values add within a separate multiplicative factor. |
| `DMG-003` | `deferred` | Enemy damage reduction is unsupported until a dedicated baseline and fixture family define it. |
| `DMG-004` | `design` | Every hit is evaluated independently and action totals sum hit results. |
| `DMG-005` | `reference-parity` | Returned normal, critical, and expected hit values preserve precision; the UI rounds the displayed action total up. |
| `DMG-006` | `design` | Damage factors may not produce negative damage; invalid negative factors are either clamped where the rule says so or rejected. |
| `DMG-007` | `design` | Arbitrary legacy `specialMultiplier` inputs are not part of the new interface. A real mechanic must receive a reviewed typed operation. |
| `DMG-008` | `deferred` | Generic flat damage on an ordinary hit is unsupported; mechanic-specific additive motion values require typed operations. |
| `DMG-009` | `baseline` | Enemy vulnerability and final-damage bonuses use typed multiplicative factors separate from ordinary bonus and amplification. |
| `DMG-010` | `baseline` | Fixed damage bypasses ordinary scaling, crit, bonus, amplification, defence, and resistance. |

## Critical hits

```text
effective critical rate = clamp(critical rate, 0, 1)
critical-damage multiplier = displayed critical damage as a ratio
```

Thus a displayed `150%` Crit. DMG is represented as `1.50`, not `0.50`.

| Rule | Status | Decision |
| --- | --- | --- |
| `CRIT-001` | `baseline` | Displayed Crit. DMG is the total critical multiplier. |
| `CRIT-002` | `design` | Effective Crit. Rate is clamped to the inclusive range `[0, 1]`. |
| `CRIT-003` | `design` | A forced-normal result ignores Crit. Rate; a forced-critical result uses the critical multiplier; expected uses the clamped rate. |
| `CRIT-004` | `design` | Actions that cannot crit declare that mechanic explicitly; their three returned outcomes are equal. |
| `CRIT-005` | `deferred` | Mechanics that alter critical behaviour for only particular hits require reviewed operations before support. |

## Defence

The baseline formula is:

```text
attacker term = 800 + 8 * attacker level

enemy defence term = (792 + 8 * enemy level)
  * (1 - total defence reduction)
  * (1 - total defence ignore)

defence multiplier = attacker term
  / (attacker term + enemy defence term)
```

Defence reduction and defence ignore remain separate additive buckets. The two
resulting bucket totals reduce enemy defence as separate multiplicative factors.
The formula does not add an extra clamp to individual contributions or to the
resulting enemy defence term.

| Rule | Status | Decision |
| --- | --- | --- |
| `DEF-001` | `baseline` | Use the level terms and constants in the equation above. |
| `DEF-002` | `baseline` | Sum reduction and ignore in separate buckets, then apply the bucket factors multiplicatively to enemy defence. |
| `DEF-003` | `baseline` | Do not clamp individual contributions or the resulting enemy defence term. |
| `DEF-004` | `deferred` | Enemy-specific defence modifiers outside reduction and ignore are unsupported until reviewed. |

## Resistance

First calculate:

```text
effective resistance = base resistance
  - resistance reduction
  - resistance ignore
```

Then:

```text
if effective resistance < 0:
  multiplier = 1 - effective resistance / 2
else if effective resistance < 0.8:
  multiplier = 1 - effective resistance
else:
  multiplier = 1 / (1 + 5 * effective resistance)
```

Negative resistance contributes at half strength. Resistance at or above 80%
uses the high-resistance branch rather than continuing the linear middle branch.

| Rule | Status | Decision |
| --- | --- | --- |
| `RES-001` | `baseline` | Resistance reduction and resistance ignore add into one total reduction value. |
| `RES-002` | `reference-parity` | Use the piecewise equation above, including the high-resistance branch. |
| `RES-003` | `design` | Resistance is selected by the action's reviewed element. |
| `RES-004` | `deferred` | Resistance effects with unusual caps, floors, or target-state dependencies require reviewed operations. |
| `RES-005` | `reference-parity` | Base resistance of exactly 100% uses the high-resistance multiplier `1 / 6`. |

## Enemy damage reduction

```text
damage-reduction factor = max(0, 1 - damage reduction)
```

| Rule | Status | Decision |
| --- | --- | --- |
| `DR-001` | `deferred` | Enemy damage reduction is unsupported until its dedicated baseline is defined. |
| `DR-002` | `design` | The final factor cannot be negative. |
| `DR-003` | `deferred` | Multiple reduction sources, bypass effects, and target-state interactions require evidence before support. |

Enemy vulnerability is not represented as negative damage reduction. It has a
separate typed factor `1 + vulnerability`, matching the damage pipeline above.

## Rounding policy

Only the named calculation stages below round. No caller may add hidden combat
rounding.

| Stage | Rule | Status |
| --- | --- | --- |
| Source percentages and motion values | Preserve supplied precision | `design` |
| Character base HP/ATK/DEF at level | Floor | `user-rule` |
| Weapon base ATK at level | Floor | `user-rule` |
| Final aggregated HP/ATK/DEF | Preserve precision; UI rounds displayed stats separately | `reference-parity` |
| Intermediate bonus, amplification, defence, and resistance factors | Preserve precision | `design` |
| Reviewed flat damage | Preserve precision until its hit is evaluated | `design` |
| Normal hit | Preserve precision | `reference-parity` |
| Critical hit | Preserve precision | `reference-parity` |
| Expected hit | Calculate from unrounded pre-crit damage and crit expectation; preserve precision | `reference-parity` |
| Multi-hit action total | Sum full-precision hit results; UI rounds the displayed total up | `reference-parity` |
| Rotation total | Sum action results; no additional transformation | `design` |
| DPS | Preserve calculation precision; UI decides display formatting | `design` |
| Timers, probabilities, confidence, and scheduling | Never gameplay-floor | `design` |

Every trace must identify each rounded input stage and preserve full-precision
damage outputs. A tiny epsilon hack
must not be added unless a fixture proves it is required to protect a decimal
value from binary floating-point representation.

## Effect eligibility and stacking

| Rule | Status | Decision |
| --- | --- | --- |
| `EFFECT-001` | `design` | Eligibility is resolved before an operation reaches the numeric kernel. |
| `EFFECT-002` | `design` | An effect declares `self`, `next`, `team`, or an explicit reviewed recipient. |
| `EFFECT-003` | `design` | Always-equipped effects are active at factor `1` and expose no toggle. |
| `EFFECT-004` | `design` | Stack counts are validated against reviewed minimum and maximum values. |
| `EFFECT-005` | `design` | Effects in a mutually exclusive mode group cannot be active together. |
| `EFFECT-006` | `baseline` | Additive stats, ordinary damage bonuses, and amplification each sum within their own matching bucket. |
| `EFFECT-007` | `deferred` | Same-name replacement, strongest-only, refresh, and independent-stack rules require mechanic-specific review. |
| `EFFECT-008` | `design` | Character eligibility restrictions must be enforced by effect resolution, not only by UI controls. |
| `EFFECT-009` | `baseline` | Vulnerability and final-damage operations each sum within their own typed bucket. |

## Healing and shields

Healing and shields are separate result kinds. Their shared basic formula is:

```text
base support value = scaling power * motion value + flat value
final support value = floor(base support value * (1 + matching support bonus))
```

They do not pass through enemy defence, resistance, damage reduction, ordinary
damage bonuses, amplification, or critical damage unless a reviewed mechanic
explicitly establishes an exception.

| Rule | Status | Decision |
| --- | --- | --- |
| `HEAL-001` | `baseline` | Healing uses reviewed stat scaling plus a flat value, then applies the matching healing bonus. |
| `HEAL-002` | `deferred` | Target-specific incoming-healing effects and caps need reviewed mechanics. |
| `SHIELD-001` | `baseline` | Shield strength uses reviewed stat scaling plus a flat value, then applies the matching shield-strength bonus. |
| `SHIELD-002` | `deferred` | Shield absorption by element, refresh/replacement, damage reduction, and remaining-strength simulation are outside the first slice. |

## Rotation rules for Step 5

The first deterministic timeline implements these invariants:

- Commands are ordered by timestamp and then original list position.
- Time is continuous in seconds.
- A one-action rotation must equal direct action calculation for the same state.
- Rotation invokes the same action implementation as direct calculation.
- Duration, timestamps, command IDs, and repetition counts are validated before
  returning any partial result.
- Repetitions multiply the resolved action result without choosing another
  calculation path.
- Rotation totals, DPS, actor totals, and damage-type totals contain damage only.
- Buff boundary behaviour, switch timing, delayed hits, cooldowns, stack
  consumption, and queued damage require independent timeline fixtures.

No choice about exact expiration boundaries is made here.

## Tune Break

`TUNE-001` supports an estimated base Tune Break hit for enemy Cost 1, 3, or 4
at character levels 1, 20, 40, 50, 60, 70, 80, and 90. The hit is modeled as
`level base × Cost factor × 12.8 × (1 + Tune Break Boost / 100) × Tune Break bonus × special multiplier × DEF × physical RES × vulnerability × final bonus × damage reduction`. Ordinary crit stats and RES shred do not apply to this base hit.
The level and Cost factors follow the [linked optimizer's model](https://github.com/ryanbenson/wuthering-waves-optimizer/blob/master/src/calculator/calculator.ts).
This is not verified against the current English in-game UI. The hand-calculated engine
fixture covers normal and critical results. Configured Tune Strain stacks boost ordinary damage using Tune Break Boost. Tune Rupture, Hack damage, Off-Tune buildup, and automatic trigger timing remain unsupported.

## Negative statuses

`STATUS-001` shows Spectro Frazzle, Aero Erosion, Fusion Burst, Electro Flare,
and Glacio Chafe damage in the attack breakdown of characters whose kits apply
or consume those statuses, including cross-element application. These are also available as rotation actions, while
the breakdown does not require a rotation. The enemy scenario supplies
stack counts; Electro Rage adds to Electro Flare's motion value. Each hit uses
`character level constant × stack motion value / 10000 × DEF × RES × status amplification`.
These hits do not inherit ordinary ATK, elemental bonuses, crit, or DEF ignore.
Havoc Bane reduces enemy DEF by 2% per configured stack and doubles the reviewed
Core of Collapse action when present. Values are estimates awaiting English in-game
verification. Automatic application, expiry, and tick scheduling are not modeled.

## Deferred formula families

These must not be implemented as ordinary damage with guessed modifiers:

- Tune Rupture, Hack damage, and Off-Tune timing
- Vibration-strength damage
- Automatic negative-status application, expiry, and tick scheduling
- Damage based on another damage instance
- Damage based on healing or shield strength
- Damage transfer or shared damage
- Partially fixed damage that bypasses only selected mitigation stages
- Enemy-state multipliers
- Summons with independently snapshotted stats
- Dynamic stat conversion and circular conversions
- Per-hit critical overrides
- Shields with absorption simulation
- Healing with recipient-side bonuses

Each family requires a reviewed rule, at least one independent fixture, and a
typed operation before it becomes supported.

## Step 2.5 accepted baseline

Accepted for Step 2 fixtures:

- Representation and determinism rules
- Separate classification axes
- ATK, HP, DEF, and hybrid scaling equations
- Per-hit damage pipeline
- Normal, critical, and expected result definitions
- Defence equation without extra over-reduction clamps
- Piecewise resistance behavior including the negative-resistance branch
- Named rounding stages
- Additive bonus, amplification, vulnerability, and final-damage buckets
- Basic fixed damage, healing, and shield formulas

Deferred and required to fail closed:

- Generic flat additions to ordinary damage
- Multiple enemy damage-reduction effects
- Incoming-healing effects, shield refresh, and shield absorption
- Tune Break follow-up and special-status formula tables
- Every deferred formula family above

The implementation must emit `unsupported-mechanic` rather than guessing any
deferred rule. Step 2.5 coverage is recorded in [`BASELINE.md`](./BASELINE.md).

## Step 2 fixture checklist

The next step may create fixtures only for rules accepted above:

1. ATK aggregation with character ATK, weapon ATK, ATK%, and flat ATK.
2. HP aggregation with HP% and flat HP.
3. DEF aggregation with DEF% and flat DEF.
4. One ATK-scaling hit.
5. One HP-scaling hit.
6. One DEF-scaling hit.
7. One hybrid-scaling hit.
8. One Energy-Regen-scaling hit.
9. Unequal multi-hit motion values with full-precision aggregation.
10. Normal, forced-critical, and expected outcomes.
11. Generic, elemental, action-specific, and damage-type bonuses in one additive bucket.
12. Multiple amplification values in their separate factor.
13. Vulnerability and final-damage factors.
14. Reviewed flat damage.
15. Defence at equal and unequal levels.
16. Defence reduction and defence ignore independently and together.
17. Negative, ordinary, and high resistance branches.
18. Resistance reduction and resistance ignore.
19. Enemy damage reduction.
20. Fixed damage that cannot crit.
21. Basic healing with stat scaling, flat healing, and healing bonus.
22. Basic shield strength with stat scaling, flat strength, and shield bonus.
23. One deliberately unsupported mechanic returning a failure.

This Step 2 checklist predates the later rotation and base Tune Break work.
Incoming-healing effects, shield simulation, Tune Break follow-ups, automatic
status timing, and other special formula families still need their own reviewed
fixtures.
