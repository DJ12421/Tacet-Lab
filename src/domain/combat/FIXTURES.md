# Independent combat calculation fixtures

Status: Step 2 fixture pack for the clean-room combat module.

These fixtures use invented inputs and the equations in [`RULES.md`](./RULES.md).
They do not import or use either legacy Tacet Lab calculator. Step 3 transcribes
these IDs and expected outcomes into tests at the public combat interface.

## Shared conventions

Unless a case overrides them:

- Attacker level: `90`
- Enemy level: `90`
- Enemy resistance: `0`
- Defence reduction and ignore: `0`
- Damage bonus, amplification, vulnerability, final damage, and enemy damage
  reduction: `0`
- Each damage case uses one hit and cannot crit unless stated otherwise
- Percentages are shown as decimal ratios
- Damage results preserve calculation precision; display formatting rounds totals up

The shared defence multiplier is:

```text
attacker term = 800 + 8 * 90 = 1520
enemy defence term = 792 + 8 * 90 = 1512

D90 = 1520 / (1520 + 1512)
    = 1520 / 3032
    = 0.5013192612137203
```

Decimals shown below are explanatory approximations. Tests compare the
full-precision expression rather than a pre-rounded display value.

## F01 — ATK aggregation

Rules: `STAT-001`, `STAT-002`, `STAT-003`.

Input:

```text
character ATK = 500.9
weapon ATK = 300.9
ATK bonus = 30% = 0.30
flat ATK = 75.25
```

Calculation:

```text
base ATK = floor(500.9) + floor(300.9)
         = 500 + 300
         = 800

final ATK = 800 * (1 + 0.30) + 75.25
          = 1115.25
```

Expected: `base ATK = 800`, `final ATK = 1115.25`.

## F02 — HP aggregation

Rules: `STAT-001`, `STAT-003`.

```text
character HP = 10000.9
HP bonus = 20% = 0.20
flat HP = 500.5

base HP = floor(10000.9) = 10000
final HP = 10000 * 1.20 + 500.5 = 12500.5
```

Expected: `base HP = 10000`, `final HP = 12500.5`.

## F03 — DEF aggregation

Rules: `STAT-001`, `STAT-003`.

```text
character DEF = 1200.9
DEF bonus = 15% = 0.15
flat DEF = 90.25

base DEF = floor(1200.9) = 1200
final DEF = 1200 * 1.15 + 90.25 = 1470.25
```

Expected: `base DEF = 1200`, `final DEF = 1470.25`.

## F04 — ATK-scaling damage

Rules: `DMG-004`, `DMG-005`, `DEF-001`.

```text
final ATK = 1000
ATK scaling ratio = 1
motion value = 1.20

scaling power = 1000 * 1 = 1000
base hit = 1000 * 1.20 = 1200
pre-crit hit = 1200 * D90
             = 601.5831134564644...
result = pre-crit hit = 601.5831134564644...
```

Expected normal/critical/expected: `601.5831134564644...` for each mode.

## F05 — HP-scaling damage

```text
final HP = 20000
HP scaling ratio = 1
motion value = 0.10

scaling power = 20000
base hit = 20000 * 0.10 = 2000
pre-crit hit = 2000 * D90
             = 1002.6385224274405...
result = 1002.6385224274405...
```

Expected normal/critical/expected: `1002.6385224274405...` for each mode.

## F06 — DEF-scaling damage

```text
final DEF = 1500
DEF scaling ratio = 1
motion value = 0.80

scaling power = 1500
base hit = 1500 * 0.80 = 1200
pre-crit hit = 1200 * D90
             = 601.5831134564644...
result = 601.5831134564644...
```

Expected normal/critical/expected: `601.5831134564644...` for each mode.

## F07 — Hybrid-scaling damage

Rules: `CLASS-008`.

```text
final ATK = 1000, ratio = 0.50
final HP = 10000, ratio = 0.02
final DEF = 1000, ratio = 0.10
motion value = 1

scaling power = 1000 * 0.50 + 10000 * 0.02 + 1000 * 0.10
              = 500 + 200 + 100
              = 800

pre-crit hit = 800 * D90
             = 401.0554089709762...
result = 401.0554089709762...
```

Expected normal/critical/expected: `401.0554089709762...` for each mode.

## F08 — Energy-Regen-scaling damage

Rules: `CLASS-006`, `CLASS-009`.

```text
final Energy Regen ratio = 1.50
displayed percentage points = 1.50 * 100 = 150
Energy Regen scaling ratio = 2
motion value = 1

scaling power = 150 * 2 = 300
pre-crit hit = 300 * D90
             = 150.3957783641161...
result = 150.3957783641161...
```

Expected normal/critical/expected: `150.3957783641161...` for each mode.

## F09 — Multi-hit precision

Rules: `DMG-004`, `DMG-005`.

```text
final ATK = 1000
hit motion values = [0.333, 0.333, 0.334]

hit 1 = 1000 * 0.333 * D90
      = 166.93931398416885...

hit 2 = 166.93931398416885...

hit 3 = 1000 * 0.334 * D90
      = 167.44063324538257...

action total = hit 1 + hit 2 + hit 3
             = 501.31926121372027...
```

The hits stay separate for tracing and effect resolution, while their
full-precision sum equals `1000 * 1.0 * D90`.

Expected hits: the three full-precision values above. Expected total:
`501.31926121372027...`.

## F10 — Normal, critical, and expected damage

Rules: `CRIT-001`, `CRIT-002`, `CRIT-003`, `DMG-005`.

```text
final ATK = 1000
motion value = 1
Crit. Rate = 25% = 0.25
Crit. DMG = 150% = 1.50

pre-crit hit = 1000 * D90
             = 501.31926121372027...

normal = 501.31926121372027...

critical = 501.31926121372027... * 1.50
         = 751.9788918205804...

expected = 501.31926121372027...
  * (1 + 0.25 * (1.50 - 1)))
         = 563.9841688654353...
```

Expected normal/critical/expected: the full-precision values above.

## F11 — Additive damage-bonus bucket

Rules: `DMG-001`.

```text
final ATK = 1000
motion value = 1
generic bonus = 0.10
elemental bonus = 0.20
damage-type bonus = 0.30
action-specific bonus = 0.05

bonus factor = 1 + 0.10 + 0.20 + 0.30 + 0.05
             = 1.65

pre-crit hit = 1000 * 1.65 * D90
             = 827.1767810026384...
result = 827.1767810026384...
```

Expected normal/critical/expected: `827.1767810026384...` for each mode.

## F12 — Multiple amplification values

Rules: `DMG-002`, `EFFECT-006`.

```text
amplification values = [0.10, 0.20]
amplification factor = 1 + 0.10 + 0.20 = 1.30

pre-crit hit = 1000 * 1.30 * D90
             = 651.7150395778364...
result = 651.7150395778364...
```

Expected normal/critical/expected: `651.7150395778364...` for each mode.

## F13 — Vulnerability and final-damage factors

Rules: `DMG-009`, `EFFECT-009`.

```text
vulnerability = 0.20, factor = 1.20
final damage = 0.10, factor = 1.10

pre-crit hit = 1000 * 1.20 * 1.10 * D90
             = 661.7414248021107...
result = 661.7414248021107...
```

Expected normal/critical/expected: `661.7414248021107...` for each mode.

## F14 — Generic flat ordinary damage fails closed

Rules: `DMG-008`.

Input: an ordinary damage action containing a generic raw flat-damage term.

Expected outcome: `unsupported-mechanic` and no damage value. A later reviewed
mechanic may add a typed motion-value operation without reopening this generic
path.

## F15 — Defence at equal and unequal levels

Rules: `DEF-001`.

Equal level result reuses `D90`:

```text
attacker level = 90
enemy level = 90
defence multiplier = 0.5013192612137203...
1000 base damage result = 501.3192612137203...
```

Unequal levels:

```text
attacker term = 800 + 8 * 90 = 1520
enemy term = 792 + 8 * 100 = 1592

defence multiplier = 1520 / (1520 + 1592)
                   = 1520 / 3112
                   = 0.4884318766066838...

1000 base damage result = 488.4318766066838...
```

Expected equal/unequal results: `501.3192612137203... / 488.4318766066838...`.

## F16 — Defence reduction and ignore

Rules: `DEF-002`, `DEF-003`.

Attacker and enemy are level 90.

Reduction only:

```text
reduction = 0.20
enemy term = 1512 * 0.80 = 1209.6
multiplier = 1520 / (1520 + 1209.6)
           = 0.5568581477139507...
1000 base damage result = 556.8581477139507...
```

Ignore only:

```text
ignore = 0.30
enemy term = 1512 * 0.70 = 1058.4
multiplier = 1520 / (1520 + 1058.4)
           = 0.5895128762022961...
1000 base damage result = 589.5128762022961...
```

Both:

```text
enemy term = 1512 * 0.80 * 0.70 = 846.72
multiplier = 1520 / (1520 + 846.72)
           = 0.6422390481341265...
1000 base damage result = 642.2390481341265...
```

Expected reduction/ignore/both: the three full-precision values above.

## F17 — Negative, ordinary, and high resistance

Rules: `RES-002`.

No resistance reduction or ignore is active.

```text
base resistance -0.20:
  multiplier = 1 - (-0.20) / 2 = 1.10
  damage = 1000 * D90 * 1.10 = 551.4511873350924...

base resistance 0.10:
  multiplier = 1 - 0.10 = 0.90
  damage = 1000 * D90 * 0.90 = 451.1873350923482...

base resistance 0.80:
  multiplier = 1 - 0.80 = 0.20
  damage = 1000 * D90 * 0.20 = 100.26385224274406...
```

Expected negative/ordinary/high results: the three full-precision values above.

## F18 — Resistance reduction and ignore

Rules: `RES-001`, `RES-002`.

Positive base resistance crossed below zero:

```text
base resistance = 0.10
reduction = 0.15
ignore = 0.05
total reduction = 0.20
excess below zero = 0.20 - 0.10 = 0.10
multiplier = 1 + 0.10 / 2 = 1.05
damage = 1000 * D90 * 1.05 = 526.3852242744063...
```

Already-negative resistance with further reduction:

```text
base resistance = -0.10
reduction = 0.20
total reduction = 0.20
effective resistance = -0.10 - 0.20 = -0.30
multiplier = 1 - (-0.30) / 2 = 1.15
damage = 1000 * D90 * 1.15 = 576.5171503957783...
```

Expected crossed/already-negative results: the two full-precision values above.

## F19 — Enemy damage reduction fails closed

Rules: `DR-001`, `DR-002`.

Input: an enemy state containing an ordinary damage-reduction operation.

Expected outcome: `unsupported-mechanic` and no damage value. The engine must
not guess whether multiple reduction, bypass, or target-state effects are
additive or multiplicative.

## F20 — Fixed damage cannot crit

Rules: `CLASS-007`, `DMG-005`, `DMG-010`, `CRIT-004`.

```text
reviewed fixed damage = 1234.75
Crit. Rate = 1
Crit. DMG = 3
enemy resistance = 0.80

fixed damage bypasses crit and enemy multipliers
returned value = 1234.75
```

Expected normal/critical/expected: `1234.75 / 1234.75 / 1234.75`.

## F21 — Basic healing

Rules: `HEAL-001` and the support rounding policy.

```text
final HP = 20000
HP scaling ratio = 1
motion value = 0.10
flat healing = 500
healing bonus = 0.20

base healing = 20000 * 0.10 + 500
             = 2500

final healing = floor(2500 * 1.20)
              = 3000
```

Expected result kind/value: `healing / 3000`.

## F22 — Basic shield strength

Rules: `SHIELD-001` and the support rounding policy.

```text
final DEF = 1500
DEF scaling ratio = 1
motion value = 0.50
flat shield strength = 250
shield bonus = 0.30

base shield = 1500 * 0.50 + 250
            = 1000

final shield = floor(1000 * 1.30)
             = 1300
```

Expected result kind/value: `shield / 1300`.

## F23 — Unsupported mechanic fails closed

Rules: `REP-006` and the clean-room module contract.

Input: a selected action whose reviewed definition declares the unsupported
formula family `damage-from-shield-strength`.

Expected outcome:

```text
ok = false
errors = [{
  code: "unsupported-mechanic",
  sourceId: "fixture:unsupported:damage-from-shield-strength",
  actorId: "fixture-actor",
  actionId: "fixture-action"
}]
warnings = []
```

No partial damage result may accompany the failure.

## Machine-test transcription table

| ID | Expected observable result |
| --- | --- |
| `F01` | base ATK `800`; final ATK `1115` |
| `F02` | base HP `10000`; final HP `12500` |
| `F03` | base DEF `1200`; final DEF `1470` |
| `F04` | `601 / 601 / 601` |
| `F05` | `1002 / 1002 / 1002` |
| `F06` | `601 / 601 / 601` |
| `F07` | `401 / 401 / 401` |
| `F08` | `150 / 150 / 150` |
| `F09` | hits `[166, 166, 167]`; total `499` |
| `F10` | `501 / 751 / 563` |
| `F11` | `827 / 827 / 827` |
| `F12` | `651 / 651 / 651` |
| `F13` | `661 / 661 / 661` |
| `F14` | `unsupported-mechanic` failure and no value |
| `F15` | equal/unequal `501 / 488` |
| `F16` | reduction/ignore/both `556 / 589 / 642` |
| `F17` | negative/ordinary/high `601 / 451 / 100` |
| `F18` | crossed/already-negative `526 / 601` |
| `F19` | `unsupported-mechanic` failure and no value |
| `F20` | `1234 / 1234 / 1234` |
| `F21` | healing `3000` |
| `F22` | shield `1300` |
| `F23` | `unsupported-mechanic` failure and no value |

## Step 2 completion gate

- All 23 selected behaviors have an invented, source-independent case.
- Every accepted numeric expected value has visible arithmetic.
- No fixture imports or calls an existing calculator.
- Deferred mechanics fail closed instead of guessing a formula.
- The unsupported case cannot silently produce a number.
- Step 3 executable tests cross the public combat interface and use these
  fixture IDs rather than testing private helpers.
