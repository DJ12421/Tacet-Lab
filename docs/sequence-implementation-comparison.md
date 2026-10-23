# S1–S6 implementation comparison and correction log

Local reference implementation: `.codex-work/combat-reference-3.7` at `061bfa80fb0ed3fac43028d75e0a0ea899dabc12` (2026-09-30). Tacet Lab: current checkout, reviewed 3.7 data.

The matrix and per-sequence details below are the **initial audit snapshot**, before the corrections in the next section. They compare reference implementation chain declarations with Tacet Lab generated effects, so a matching declaration does not establish identical runtime behavior. reference implementation also has character-specific calculator code. Tacet Lab has separate activation, target-filter, action, and damage-formula paths. No tests, builds, or browser checks were run.

## Corrections applied after the snapshot

These reviewed data corrections have been compiled into `src/game-data/combat/reviewed-mechanics.generated.ts`. Each entry is gated by its sequence and uses the existing reviewed-effect inputs.

| Character / sequence | Correction |
|---|---|
| Jinhsi S1 | Add 20% damage bonus per Incandescence stack to both Illuminous Epiphany hits. |
| Taoqi S1 | Add 40% shield bonus to the three Defense Formation shield actions. |
| Camellya S3 | Add 50% motion value to the enhanced Blossom attack. |
| Mornye S5 | Add 40% motion value to her Liberation action. |
| Chisa S2 | Add 10% Havoc resistance reduction. |
| Roccia S3, S5 | Add the missing 30% critical damage; correct S5 to 20% Liberation and 80% Heavy motion value. |
| Hiyuki S6 | Add 500% critical damage to both specified Liberation attacks. |
| Qingxiao S3 | Add 100% critical damage to the specified Liberation attack. |
| Phrolova S6 | Add 24% motion value to the three enhanced Hecate attacks. |
| Lucy S3 | Add 50% motion value and 100% critical damage to the two specified Liberation attacks. |
| Denia S2 | Add 1% Fusion resistance ignore per Erosion Field stack, capped at ten. |
| Galbrena S6 | Add 60% motion value to the eleven enhanced attacks. |
| Cartethyia S2 | Narrow the 50% increase to its seven specified attacks and add 200% to the four midair attacks. |
| Jingran S2 | Add 180% damage amplification to both specified attacks. |
| Lupa S3 | Add the 15% team Fusion resistance ignore and suppress the earlier 3% per Fusion member effect while S3 is active. |
| Verina S3, S6 | Add 12% motion value to Photosynthesis Mark coordinated healing and 20% to the four Starflower damage actions. S6's extra hit and team heal remain unresolved. |

The snapshot's WT-only classification for Jinhsi S1, Taoqi S1, and Verina S3/S6 changes to **Both** after these corrections. Its declaration counts become Both 298, WT only 19, TL only 5, Neither 56, Unreviewed 6. Those counts describe presence of declarations, not equivalent calculations.

## Subsequent kit implementation pass

The current reviewed manifests and compiler add a special-multiplier operation, attack-category overrides, Energy Regen-derived stats, and explicit action filters for reviewed triggers. These are combat-contract changes approved by the user. Later kit corrections cover Aalto's forced critical hit and ATK buff, Baizhi's Heavy Attack healing, Galbrena's Afterflame stacks, Cartethyia S6, Qiuyuan's targeted motion increase, Lucy's Cyberware Malfunction, Phrolova S6, Sigrika S6, Suisui's resistance reduction, Lucilla's two modes, Camellya's Seedbed category, Denia's Breakdown Form and Liberation category, Mornye's field and Critical Protocol, Brant's Energy Regen conversion, and Shorekeeper's Stellarealm conversion.

An action-by-action comparison across all 64 local kits found 164 explicit damage-category differences in 41 characters. These were corrected in the reviewed attacks; six generic-label matches were rejected after comparing their rank-one formulas. This pass did not alter damage percentages or level curves. Hsin's six sequence descriptions and 62 character-effect candidate entries were manually reviewed. The supported outgoing-damage effects now compile; resource, defensive, and target-state clauses are marked as unsupported in the review manifest rather than accepting the parser's incorrect outgoing-damage interpretation.

A second sequence pass added Aalto S3's Mist bullets, Chisa S5's Liberation bonus, Iuno S4's shield trigger, Mortefi S5's Marcato follow-ups, both Havoc Rover S5 extra hits, Xiangli Yao S1's six projectiles, Yinlin S1/S5's targeted increases, Yuanwu S3/S4's extra DEF hit and shield, Zhezhi S5/S6's extra attacks, and Cantarella S5's five extra Dreamweaver hits. It also limited attack-triggered follow-ups in twelve kits to their triggering actions, removed Augusta S6's duplicate Thunder Rage payload, corrected Mornye S6 from an unrelated extra hit to a Critical Protocol motion increase, isolated Camellya's Perennial trigger from its Sweet Dream multiplier, and corrected Luuk Herssen S2's Tune Break Boost conversion. Brant S4 now has the shield increase and Energy Regen-based team heal, using a rank-one supplemental Returned from Ashes formula.

The character-effect pass corrected Cartethyia's Wind's Indelible Imprint stacking, Yangyang: Xuanling's six Feathered Oath stacks, Zani's Inferno Mode attack multipliers, and Suisui's Sky Over Water bonus on both specified attacks. Hsin's delayed Heart of Thunder Electro Flare hit now scales with its stack input, and S1 replaces the 35% coefficient with 42%. Hsin S6's fixed Electro Flare critical values now run in the status calculation, including that referenced hit. Each reviewed stack or stance uses its own input so the calculator can represent the stated condition.

Aemeath's Seraphic Duet in Fusion Burst mode now triggers the reviewed Fusion Burst status action. Fusion Trail stacks add 10% per removed stack to that status multiplier, and Stardust Resonance adds 200% on the same action; these bonuses add before the status damage calculation. Her S6 adds 40% amplification to her Liberation attacks and sets Fusion Burst status crit to 80% / 275%. Her separate Tune Rupture action now uses its Tune AMP formula with enemy Cost and Tune Break Boost rather than ATK scaling. Seraphic Duet triggers five instances, replaced by ten during Stardust Resonance; removed Rupturous Trail stacks add 4% each and S6 applies its fixed 80% / 275% critical values. At S2, an optional same-target toggle applies the average one-second repeated-hit ramp: 40% across five hits or 70% across ten. The selected target receives all instances in the calculation; the game can distribute them randomly across targets.

The Tune AMP formula also corrects the reviewed response actions for Mornye, Rebecca, Lynae, and Lucy. Lucy's Data Crash has a five-part Tune AMP expression; the compiler now keeps all five reviewed components rather than treating them as ATK hits. Lynae's Visual Impact now grants 40 Tune Break Boost to the team through its 30-second reviewed toggle, and that boost reaches Tune AMP, base Tune Break, and Tune Strain calculations.

Tune Break Boost effects are now carried as point bonuses rather than being mistaken for Tune Break damage percentages. This corrects the reviewed Denia, Rebecca, Lynae, and Sonata 31 bonuses. Denia's Fusion Burst and Tune Strain inherent modes now use separate toggles; Tune Strain grants 10 team Tune Break Boost, her S2 can grant another 20, and her Off-Tune excess input adds 8 per ten points up to 40. Recipients and activation timing for these buffs are still selected manually.

At Aemeath S2, the Fusion Trail bonus replaces 10% per stack with 15%, and the Stardust bonus replaces 200% with 400%. The effects share their inputs across the sequence boundary and are gated so both versions cannot stack together.

The later action-enable review added Hsin S3's final-stage Electro Flare hit, Brant S6's 30% Returned from Ashes blast, Qingxiao S1's Juque Perdition with its 4% per consumed seal increase, Roccia S6's Reality Recreation after Real Fantasy Stage 3 and its scoped DEF ignore, and Verina S6's Photosynthesis Mark coordinated hit and team heal. Qiuyuan's Sundering Strike is now classified as Echo Skill DMG and receives the S3 500% motion increase. His S3 replacement skill and Outro and S6 exit burst are selectable, sequence-gated Echo Skill actions. Brant S2's 440% Outro blast was removed from Returned from Ashes: its actual trigger is an incoming teammate's skill after his Outro. It is now a selectable sequence-gated Basic Attack DMG action with a one-second cooldown and a two-use rotation limit; its Outro window still needs linked team action state.

Additional sequence corrections include Jiyan S5 and Xiangli Yao S5 on their Outro actions, Luuk Herssen S5 on his Intro and Outro, Camellya S6's Sweet Dream action scope and post-Perennial increase, Jingran S6's target Heavy amplification, Lucy S6's conditional Heavy and Hack bonuses, Yangyang: Xuanling S2's named attacks and Strung Notes hit, Denia S6's Erosion Field Fusion Burst, and Qingxiao S6's restricted damage amplification. Xuanling's local reference implementation numeric modifier targets different attacks from its own sequence text; the reviewed implementation follows the text and records the conflict.

The following buff and support review also corrected Phoebe's Confession Silent Prayer to grant its timed Spectro Frazzle amplification and Spectro resistance reduction; Sigrika's Soliskin Vitality to scale with Vitality consumed; Jianxin's Formless Release and Reflection; Jiyan's two mutually exclusive Windqueller modes; Lingyang's Diligent Practice follow-up; and Jingran's base and S3 HP-derived ATK, Fusion, and Fortune in Disguise bonuses. Iuno's Waxing Ascent shield, Jingran's two inherent shields, Augusta's Ruler's Realm shield, Verina's Grace of Life shield, Mornye's Boundedness heal, Youhu's Antique Appraisal team heal, and Aemeath's, Cartethyia's, and Lucy's S5 defensive shields are selectable support actions. Ciaccona's Interlude Tune shield now triggers from the Liberation cast once, rather than also from a later tonic hit. These manual inputs and selected actions do not track elapsed time, target ownership, or resource consumption across a rotation. Cartethyia's S5 shield follows the local reference implementation action table's 25% Max HP; its sequence description instead says 20%.

## Implementation differences still open

The local audit covers all 64 character buff files and every S1–S6 chain. Each chain that enables an additional WT attack or support action was checked against the reviewed action, triggered effect, or an explicit gap below. Source labels alone were not treated as matching proof; several WT actions have copied or alternate labels.

- **Action and event state:** reference implementation declares attacks that are absent from the reviewed action list, including triggered or conditional hits. The name-based inventory reports 294 unmatched WT labels; this includes alternate labels and source-only triggered actions, so it is an investigation list, not 294 confirmed missing attacks. Some triggered effects still lack action IDs or rotation-wide trigger limits.
- **Remaining defensive event state:** Aemeath S5, Cartethyia S5, and Lucy S5 shields are sequence-gated manual actions; the outgoing-damage action model does not detect the fatal blow or low-HP hit that grants them, nor enforce their cooldowns. Iuno's base Arc Beyond the Edge action remains an unsupported supplemental formula. Brant's Returned from Ashes supplement currently uses rank-one formulas; its level curve is not represented.
- **Fixed and linked values:** Several remaining effects link to another action or consume a buff in a rotation, so manual inputs can diverge from real timing and talent levels. Conditional effects that read a member's Tune Break Boost, such as Luuk Herssen's conversion, still read the member input rather than an active teammate's added boost. The fixed critical values and explicit replacements listed above are implemented only for their specified actions.
- **Aemeath Tune Rupture:** The Tune AMP formula, five or ten instances, removed Rupturous Trail scaling, S2 same-target average ramp, and S6 fixed critical values are implemented. The calculator assigns every instance to the selected target; random target allocation and exact timing of the S2 one-second ramp are not tracked. Disable the same-target toggle when hits split across targets or outside that window. The S2 Fusion Trail and Stardust replacements on Fusion Burst are also implemented.
- **Hsin target effects:** S6's fixed 80% critical rate and 230% critical damage now apply to Hsin's Electro Flare status action and delayed Heart of Thunder hit. The status estimate only supports its existing stack table; Hsin's 16-stack Fleeting Thunder state, Unison Boon recipient eligibility, and Heart of Thunder resource timing still require target and resource state. Hsin S5's defensive effect is outside the outgoing-damage calculation. Hsin's reviewed sequence entries identify these limits.
- **Support recipient routing:** Some heals, shields, and buffs apply only to the next character, the lowest-HP member, or a character with a named state. Augusta's Ruler's Realm shield is shown as a team support result, but its actual recipient is the member who casts an Intro within the field; current self/team routing cannot express that recipient.
- **Additional conditional actions:** Qiuyuan's S3/S6 replacement actions can be selected at the right sequence but their Concerto and Inksplash state transitions remain manual. Sequence-gated supplemental actions are rejected during calculation below their required sequence, though the target picker can still list them before that sequence. Chisa S1's action explicitly reports unsupported until enemy HP and per-target use state can enforce its 61.8% floor. Brant S2's Outro blast must be inserted after an incoming teammate's skill; its one-second cooldown and two-use limit are enforced for rotation commands, while its 20-second window is not. Qingxiao's Juque Perdition and Xuanling's Strung Notes are represented through manual stack/toggle inputs; once-per-second and one-time consumption require rotation timing. Denia S6's per-target reset and Jingran S6's eight-charge summon limit also need rotation event state.
- **Other non-damage mechanics:** Energy, cooldown, movement, interruption resistance, and defensive effects in kit descriptions are not modeled by the deterministic outgoing-damage calculator. The initial declaration snapshot below is therefore not a claim of complete behavior parity.
- **Regeneration:** The reviewed compiler lives in ignored local `.local-tools/`. Its new Tune AMP, trigger, and condition-boost rules are present in this checkout and the generated catalog, but must be carried into a tracked generator before another machine can reproduce this catalog from the review manifests.

The initial matrix below predates all of these corrections and must be read as a historical audit snapshot.

## Initial declaration snapshot

**Difference**: WT only or TL only means only that side has a declared executable modifier, triggered action, or use adjustment in these sequence definitions. “Both” means both have declarations; inspect the two summaries for type, value, target, and stack differences. “Neither” means neither has a declared numeric effect here; non-damage utility may still exist.

| Character | S1 | S2 | S3 | S4 | S5 | S6 |
|---|---|---|---|---|---|---|
| Aalto (1403) | Neither | Both | WT only | Both | Both | Both |
| Aemeath (1210) | Both | Both | Both | Both | WT only | Both |
| Augusta (1306) | TL only | Both | Both | Both | Both | Both |
| Baizhi (1103) | Neither | Both | Both | Both | Neither | Both |
| Brant (1206) | Both | Both | Both | WT only | Both | Both |
| Buling (1307) | Both | Neither | Both | Both | Neither | TL only |
| Calcharo (1301) | Neither | Both | Both | Both | Both | Both |
| Camellya (1603) | Both | Both | Both | Both | Both | Both |
| Cantarella (1607) | Both | Both | Both | Both | WT only | Both |
| Carlotta (1107) | Both | Both | Both | Both | Both | Both |
| Cartethyia (1409) | Both | Both | Both | Both | WT only | Both |
| Changli (1205) | Both | Both | Both | Both | Both | Both |
| Chisa (1508) | Both | Both | Both | Neither | WT only | Both |
| Chixia (1202) | Both | Neither | Both | Neither | Both | Both |
| Ciaccona (1407) | Both | Both | Neither | Both | Both | Both |
| Danjin (1602) | Both | Both | Both | Both | Both | Both |
| Denia (1211) | Both | Both | Both | Neither | Both | Both |
| Encore (1203) | Both | Neither | Both | Both | Both | Both |
| Galbrena (1208) | TL only | TL only | Both | Both | Both | Both |
| Hiyuki (1108) | Both | Both | Both | Both | Both | Both |
| Hsin (1311) | Unreviewed | Unreviewed | Unreviewed | Unreviewed | Unreviewed | Unreviewed |
| Iuno (1410) | Both | Both | Both | WT only | Both | Both |
| Jianxin (1405) | Neither | Neither | Neither | Both | Neither | Both |
| Jingran (1212) | Both | Both | Both | Both | Neither | Both |
| Jinhsi (1304) | WT only | Neither | Both | Both | Both | Both |
| Jiyan (1404) | Neither | Both | Both | Both | Both | Both |
| Lingyang (1104) | Neither | Neither | Both | Both | Both | Both |
| Lucilla (1109) | Both | Both | Both | Both | Both | Both |
| Lucy (1511) | Both | Both | Both | Both | WT only | Both |
| Lumi (1504) | Neither | Both | Both | Both | Both | Both |
| Lupa (1207) | Both | Both | Both | Both | Both | Both |
| Luuk Herssen (1510) | Both | Both | Both | Both | Both | Both |
| Lynae (1509) | Both | Both | Both | Both | Both | Both |
| Mornye (1209) | Neither | Both | Neither | Both | Both | Both |
| Mortefi (1204) | Neither | Neither | Both | Neither | WT only | Both |
| Phoebe (1506) | Both | Both | Both | Both | Both | Both |
| Phrolova (1608) | Both | Both | Both | Both | TL only | Both |
| Qingxiao (1413) | Both | Both | Both | Both | Both | Both |
| Qiuyuan (1411) | Both | Both | Both | Both | Both | Both |
| Rebecca (1308) | Both | Both | Both | Neither | Both | Both |
| Roccia (1606) | Neither | Both | Both | Both | Both | Both |
| Rover: Aero M (1406) | Neither | Both | Both | Both | Both | Both |
| Rover: Aero F (1408) | Neither | Both | Both | Both | Both | Both |
| Rover: Electro M (1309) | Neither | Neither | Both | Both | Both | Both |
| Rover: Electro F (1310) | Neither | Neither | Both | Both | Both | Both |
| Rover: Havoc F (1604) | Both | Neither | Neither | Both | WT only | Both |
| Rover: Havoc M (1605) | Both | Neither | Neither | Both | WT only | Both |
| Rover: Spectro M (1501) | Both | Both | Both | Both | Both | Both |
| Rover: Spectro F (1502) | Both | Both | Both | Both | Both | Both |
| Sanhua (1102) | Both | Neither | Both | Both | Both | Both |
| Shorekeeper (1505) | Neither | Both | Neither | Both | Neither | Both |
| Sigrika (1412) | Both | Both | Neither | Both | Both | Both |
| Suisui (1110) | Neither | Both | Neither | Both | Both | Both |
| Suoming (1312) | Both | Both | Both | Both | Both | Both |
| Taoqi (1601) | WT only | Both | Neither | Both | Both | Both |
| Verina (1503) | WT only | Neither | WT only | Both | Both | WT only |
| Xiangli Yao (1305) | WT only | Both | Both | Both | Both | Both |
| Yangyang (1402) | Both | Neither | Both | Both | Both | Both |
| Yangyang: Xuanling (1610) | Both | Both | Both | Both | Neither | Both |
| Yinlin (1302) | WT only | Neither | Both | Both | WT only | Both |
| Youhu (1106) | Neither | Both | Both | Neither | Both | Both |
| Yuanwu (1303) | Neither | Neither | WT only | WT only | Both | Both |
| Zani (1507) | Both | Both | Both | Both | Both | Both |
| Zhezhi (1105) | Both | Neither | Both | Both | WT only | WT only |

Totals across 64 characters / 384 sequence slots: Both 294; WT only 23; TL only 5; Neither 56; Unreviewed 6.

The five “TL only” rows are declaration-level findings. reference implementation handles Augusta S1, Buling S6, and Galbrena S1/S2 in `src/calculator/stats.ts` despite empty chain modifier arrays. Phrolova S5 has no declared reference implementation modifier or direct calculator reference to its chain key in this checkout.

Tacet Lab has 27 generated sequence effects with triggered actions or action-use adjustments; reference implementation has 44 `EnableAttack` chain modifiers. Those mechanisms are represented differently and require action-level comparison before claiming numeric parity.

## Per-sequence details

## Aalto (1403)

WT source: [Aalto/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Aalto/resonanceChains.ts). TL source: [1403.review.json](../src/game-data/mechanics-reviews/3.7/1403.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | ATK 0.15 | toggle: add-percent-stat atk 0.15 | Both |
| S3 | EnableAttack SequenceNode3HazeyTransitionHalfTruthsStage1DMG, SequenceNode3HazeyTransitionHalfTruthsStage2DMG, SequenceNode3HazeyTransitionHalfTruthsStage3DMG, SequenceNode3HazeyTransitionHalfTruthsStage4DMG, SequenceNode3HazeyTransitionHalfTruthsStage5DMG, SequenceNode3HazeyTransitionHalfTruthsMidAirAttackDMG | No generated sequence effect | WT only |
| S4 | targeted multiplier 0.3 → 1 talent(s) | always: add-damage-bonus 0.3 → 2 action(s) / toggle: reduce-damage-taken 0.3 | Both |
| S5 | Aero 0.25 | toggle: add-damage-bonus 0.25 | Both |
| S6 | CritRate 0.08 → 1 talent(s); targeted multiplier 0.5 → 2 talent(s) | toggle: add-flat-stat critRate 0.08 / toggle: add-damage-bonus 0.5 → 2 action(s) | Both |

## Aemeath (1210)

WT source: [Aemeath/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Aemeath/resonanceChains.ts). TL source: [1210.review.json](../src/game-data/mechanics-reviews/3.7/1210.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritDMG 3 → 4 talent(s) | toggle: add-flat-stat critDamage 3 → 10 action(s) | Both |
| S2 | talentModifierMultiply 1 → 2 talent(s) / Tune Rupture: specialMultiplier 0.2 → 1 talent(s) (up to 5 stacks) / Fusion Burst: No declared modifier | always: increase-motion-value 1 → 1 action(s) / always: increase-motion-value 1 → 1 action(s) | Both |
| S3 | talentModifierMultiply 0.4 → 1 talent(s); talentModifierMultiply 1 → 1 talent(s) | always: increase-motion-value 1 → 1 action(s) / always: increase-motion-value 0.4 → 1 action(s) / toggle: add-flat-stat critDamage 0.6 → 9 action(s) / toggle: add-flat-stat critDamage 0.6 → 9 action(s) | Both |
| S4 | AllElementAttributeBonus 0.2 | toggle: add-damage-bonus 0.2 (team) | Both |
| S5 | EnableAttack SequenceNode5VoyagetotheAstralShore | No generated sequence effect | WT only |
| S6 | specialMultiplier 0.4 → 8 talent(s) / Tune Rupture: CritRate 0.8 → 2 talent(s); CritDMG 1.75 → 2 talent(s) / Fusion Burst: CritRate 0.8 → 1 talent(s); CritDMG 1.75 → 1 talent(s) | toggle: add-damage-bonus 0.8 | Both |

## Augusta (1306)

WT source: [Augusta/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Augusta/resonanceChains.ts). TL source: [1306.review.json](../src/game-data/mechanics-reviews/3.7/1306.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | stacks ≤1: add-flat-stat critDamage 0.15 | TL only |
| S2 | CritOverflow 0.02 | stacks ≤1: add-flat-stat critRate 0.2 / toggle: add-flat-stat critDamage 0.02 | Both |
| S3 | talentModifierMultiply 0.25 → 7 talent(s) | toggle: increase-motion-value 0.25 → 7 action(s) | Both |
| S4 | ATK 0.2 | toggle: add-percent-stat atk 0.2 (team) | Both |
| S5 | talentModifierMultiply 0.5 → 1 talent(s) | toggle: add-flat-stat shieldBonus 0.5 → 1 action(s) | Both |
| S6 | CritOverflow 0.02; EnableAttack SequenceNode6EngravedinRadiantLight | value ≤25: add-flat-stat critDamage 0.02 / toggle: 1 triggered action(s) / toggle: 1 triggered action(s) | Both |

## Baizhi (1103)

WT source: [Baizhi/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Baizhi/resonanceChains.ts). TL source: [1103.review.json](../src/game-data/mechanics-reviews/3.7/1103.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | Glacio 0.15; HealingBonus 0.15 | toggle: add-damage-bonus 0.15; add-flat-stat healingBonus 0.15 | Both |
| S3 | HP 0.12 | toggle: add-percent-stat hp 0.12 | Both |
| S4 | talentModifierMultiply 0.2 → 1 talent(s); EnableAttack SequenceNode4EternalVerity | toggle: add-flat-stat healingBonus 0.2 → 1 action(s); 1 triggered action(s); 1 use adjustment(s) | Both |
| S5 | No declared modifier | No generated sequence effect | Neither |
| S6 | Glacio 0.12 | toggle: add-damage-bonus 0.12 (team) | Both |

## Brant (1206)

WT source: [Brant/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Brant/resonanceChains.ts). TL source: [1206.review.json](../src/game-data/mechanics-reviews/3.7/1206.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | DMGBonus 0.2 (up to 3 stacks) | stacks ≤3: add-damage-bonus 0.2 → 4 action(s) | Both |
| S2 | CritRate 0.3 → 12 talent(s); EnableAttack SequenceNode2ForSmilesandCheers | toggle: add-flat-stat critRate 0.3 → 11 action(s); 1 triggered action(s) / toggle: 1 triggered action(s) | Both |
| S3 | talentModifierMultiply 0.42 → 2 talent(s) | toggle: increase-motion-value 0.42 → 1 action(s) | Both |
| S4 | EnableAttack SequenceNode4ToFreedomISing; targeted multiplier 0.2 → 1 talent(s) | No generated sequence effect | WT only |
| S5 | BasicAttackDMGBonus 0.15 | toggle: add-damage-bonus 0.15 | Both |
| S6 | talentModifierMultiply 0.3 → 10 talent(s); EnableAttack SequenceNode6AlltheWorldsaCaptainsCarnevale | always: increase-motion-value 0.3 → 4 action(s) | Both |

## Buling (1307)

WT source: [Buling/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Buling/resonanceChains.ts). TL source: [1307.review.json](../src/game-data/mechanics-reviews/3.7/1307.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 0.2 → 1 talent(s) | always: add-flat-stat critRate 0.2 → 1 action(s) | Both |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | EnableAttack SequenceNode3SummonerofSpiritsSeekerofFate | toggle: 1 triggered action(s) | Both |
| S4 | HealingBonus 0.2 | always: add-flat-stat healingBonus 0.2 | Both |
| S5 | No declared modifier | No generated sequence effect | Neither |
| S6 | No declared modifier | toggle: add-damage-bonus 0.25 (team) | TL only |

## Calcharo (1301)

WT source: [Calcharo/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Calcharo/resonanceChains.ts). TL source: [1301.review.json](../src/game-data/mechanics-reviews/3.7/1301.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | ResonanceSkillDMGBonus 0.3 | toggle: add-damage-bonus 0.3 | Both |
| S3 | Electro 0.25 | toggle: add-damage-bonus 0.25 | Both |
| S4 | Electro 0.2 | toggle: add-damage-bonus 0.2 (team) | Both |
| S5 | IntroSkillDMGBonus 0.5 | toggle: increase-motion-value 0.5 → 2 action(s) | Both |
| S6 | EnableAttack SequenceNode6TheUltimatum | toggle: 1 triggered action(s) | Both |

## Camellya (1603)

WT source: [Camellya/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Camellya/resonanceChains.ts). TL source: [1603.review.json](../src/game-data/mechanics-reviews/3.7/1603.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritDMG 0.28 | toggle: add-flat-stat critDamage 0.28 | Both |
| S2 | talentModifierMultiply 1.2 → 2 talent(s) | always: increase-motion-value 1.2 → 1 action(s) | Both |
| S3 | talentModifierMultiply 0.5 → 1 talent(s) / ATK 0.58 | toggle: add-percent-stat atk 0.58 | Both |
| S4 | BasicAttackDMGBonus 0.25 | toggle: add-damage-bonus 0.25 (team) | Both |
| S5 | talentModifierMultiply 3.03 → 1 talent(s); talentModifierMultiply 0.68 → 2 talent(s) | toggle: increase-motion-value 3.03 → 1 action(s) / toggle: increase-motion-value 0.68 → 2 action(s) | Both |
| S6 | talentModifierMultiply 1.5 → 17 talent(s); EnableAttack SequenceNode6PerennialDMG / talentModifierMultiplySetValue 2.5 → 17 talent(s) | toggle: increase-motion-value 1.5 → 17 action(s); 1 triggered action(s) | Both |

## Cantarella (1607)

WT source: [Cantarella/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Cantarella/resonanceChains.ts). TL source: [1607.review.json](../src/game-data/mechanics-reviews/3.7/1607.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | talentModifierMultiply 0.5 → 3 talent(s) | always: increase-motion-value 0.5 → 4 action(s) | Both |
| S2 | talentModifierMultiply 2.45 → 1 talent(s) | toggle: increase-motion-value 2.45 → 1 action(s) | Both |
| S3 | talentModifierMultiply 3.7 → 1 talent(s) | always: increase-motion-value 3.7 → 1 action(s) | Both |
| S4 | HealingBonus 0.25 | toggle: add-flat-stat healingBonus 0.25 | Both |
| S5 | talentReplace [object Object] → 1 talent(s) | No generated sequence effect | WT only |
| S6 | talentModifierMultiply 0.8 → 3 talent(s) / DEFIgnore 0.3 | always: increase-motion-value 0.8 → 3 action(s) / toggle: ignore-defense 0.3 → 1 action(s) | Both |

## Carlotta (1107)

WT source: [Carlotta/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Carlotta/resonanceChains.ts). TL source: [1107.review.json](../src/game-data/mechanics-reviews/3.7/1107.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 0.125 | toggle: add-flat-stat critRate 0.125 | Both |
| S2 | talentReplace [object Object] → 1 talent(s) | always: increase-motion-value 1.26 → 1 action(s) | Both |
| S3 | EnableAttack SequenceNode3StepForwardEleganceinProgression; talentModifierMultiply 0.93 → 2 talent(s) | toggle: 1 triggered action(s) / always: increase-motion-value 0.93 → 1 action(s) | Both |
| S4 | ResonanceSkillDMGBonus 0.25 | toggle: add-damage-bonus 0.25 (team) | Both |
| S5 | talentModifierMultiply 0.47 → 1 talent(s) | always: increase-motion-value 0.47 → 2 action(s) | Both |
| S6 | talentReplace [object Object] → 1 talent(s) | always: increase-motion-value 1.866 → 1 action(s) | Both |

## Cartethyia (1409)

WT source: [Cartethyia/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Cartethyia/resonanceChains.ts). TL source: [1409.review.json](../src/game-data/mechanics-reviews/3.7/1409.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritDMG 0.25 → 16 talent(s) (up to 4 stacks) | stacks ≤4: add-flat-stat critDamage 0.25 | Both |
| S2 | talentModifierMultiply 0.5 → 7 talent(s); talentModifierMultiply 2 → 4 talent(s) | always: increase-motion-value 0.5 → 10 action(s) | Both |
| S3 | talentModifierMultiply 1 → 1 talent(s) | always: increase-motion-value 1 → 1 action(s) | Both |
| S4 | Fusion 0.2; Glacio 0.2; Electro 0.2; Aero 0.2; Havoc 0.2; Spectro 0.2 | toggle: add-damage-bonus 0.2 (team) | Both |
| S5 | EnableAttack Sequence5HopeReshapedinStormsShield | No generated sequence effect | WT only |
| S6 | specialMultiplier 0.4 → 16 talent(s) | toggle: amplify-damage 0.4 → 16 action(s); 1 triggered action(s) | Both |

## Changli (1205)

WT source: [Changli/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Changli/resonanceChains.ts). TL source: [1205.review.json](../src/game-data/mechanics-reviews/3.7/1205.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | targeted multiplier 0.1 → 4 talent(s) | always: add-damage-bonus 0.1 → 2 action(s) | Both |
| S2 | CritRate 0.25 | toggle: add-flat-stat critRate 0.25 | Both |
| S3 | ResonanceLiberationDMGBonus 0.8 | toggle: increase-motion-value 0.8 → 1 action(s) | Both |
| S4 | ATK 0.2 | toggle: add-percent-stat atk 0.2 (team) | Both |
| S5 | talentModifierMultiply 0.5 → 1 talent(s); targeted multiplier 0.5 → 1 talent(s) | always: add-damage-bonus 0.5 → 2 action(s) | Both |
| S6 | DEFIgnore 0.4 → 5 talent(s) | toggle: ignore-defense 0.4 → 2 action(s) | Both |

## Chisa (1508)

WT source: [Chisa/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Chisa/resonanceChains.ts). TL source: [1508.review.json](../src/game-data/mechanics-reviews/3.7/1508.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | ATK 0.3; EnableAttack SequenceNode1WanderingThroughtheDesolateCorridors | toggle: add-percent-stat atk 0.3 | Both |
| S2 | ResistShred:Havoc 0.1; AllElementAttributeBonus 0.5 | always: add-damage-bonus 0.5 (team) | Both |
| S3 | talentModifierMultiply 1.2 → 10 talent(s) | toggle: increase-motion-value 1.2 → 7 action(s) | Both |
| S4 | No declared modifier | No generated sequence effect | Neither |
| S5 | targeted multiplier 1 → 1 talent(s) | No generated sequence effect | WT only |
| S6 | specialMultiplier 0.4; DMGDeepen:SpectroFrazzle 0.3; DMGDeepen:AeroErosion 0.3; DMGDeepen:ElectroFlare 0.3; DMGDeepen:FusionBurst 0.3; DMGDeepen:GlacioChafe 0.3 | always: amplify-damage 0.3 / always: add-damage-bonus 0.4 | Both |

## Chixia (1202)

WT source: [Chixia/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Chixia/resonanceChains.ts). TL source: [1202.review.json](../src/game-data/mechanics-reviews/3.7/1202.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 1 → 1 talent(s) | always: override-crit → 1 action(s) | Both |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | targeted multiplier 0.4 → 1 talent(s) | toggle: add-damage-bonus 0.4 → 1 action(s) | Both |
| S4 | No declared modifier | No generated sequence effect | Neither |
| S5 | ATK 0.3 | toggle: add-percent-stat atk 0.3 | Both |
| S6 | BasicAttackDMGBonus 0.25 | toggle: add-damage-bonus 0.25 (team) | Both |

## Ciaccona (1407)

WT source: [Ciaccona/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Ciaccona/resonanceChains.ts). TL source: [1407.review.json](../src/game-data/mechanics-reviews/3.7/1407.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | ATK 0.35 | toggle: add-percent-stat atk 0.35 | Both |
| S2 | Aero 0.4 | toggle: add-damage-bonus 0.4 (team) | Both |
| S3 | No declared modifier | No generated sequence effect | Neither |
| S4 | DEFIgnore 0.45 → 4 talent(s) | toggle: ignore-defense 0.45 → 2 action(s) / toggle: ignore-defense 0.45 | Both |
| S5 | ResonanceLiberationDMGBonus 0.4 | always: add-damage-bonus 0.4 | Both |
| S6 | EnableAttack SequenceNode6UnendingCadence | toggle: 1 triggered action(s) | Both |

## Danjin (1602)

WT source: [Danjin/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Danjin/resonanceChains.ts). TL source: [1602.review.json](../src/game-data/mechanics-reviews/3.7/1602.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | ATK 0.05 (up to 6 stacks) | stacks ≤6: add-percent-stat atk 0.05 | Both |
| S2 | DMGBonus 0.2 | toggle: add-damage-bonus 0.2 | Both |
| S3 | ResonanceLiberationDMGBonus 0.3 | always: add-damage-bonus 0.3 | Both |
| S4 | CritRate 0.15 | toggle: add-flat-stat critRate 0.15 | Both |
| S5 | Havoc 0.15 / Havoc 0.15 | always: add-damage-bonus 0.15 / toggle: add-damage-bonus 0.15 | Both |
| S6 | ATK 0.2 | toggle: add-percent-stat atk 0.2 (team) | Both |

## Denia (1211)

WT source: [Denia/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Denia/resonanceChains.ts). TL source: [1211.review.json](../src/game-data/mechanics-reviews/3.7/1211.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritDMG 0.3 | always: add-flat-stat critDamage 0.3 | Both |
| S2 | talentModifierSpecialMultiply 0.4 → 2 talent(s) / Fusion Burst: Fusion 0.5 / Fusion Burst: ResistShred:Fusion 0.01 (up to 10 stacks) / Tune Strain: tuneBreakBoost 0.2 | toggle: add-damage-bonus 0.5 / toggle: add-damage-bonus 0.2 / always: increase-motion-value 0.4 → 15 action(s) | Both |
| S3 | talentModifierMultiply 0.8 → 1 talent(s) | always: increase-motion-value 0.8 → 15 action(s) / toggle: increase-motion-value 12 → 9 action(s) | Both |
| S4 | No declared modifier | No generated sequence effect | Neither |
| S5 | talentModifierMultiply 1 → 1 talent(s) | always: add-damage-bonus 1 → 9 action(s) | Both |
| S6 | ATK 0.6; Fusion 0.6 / Fusion Burst: talentModifierMultiply 2 → 1 talent(s) / Tune Strain: No declared modifier | toggle: add-damage-bonus 0.6; add-percent-stat atk 0.6 | Both |

## Encore (1203)

WT source: [Encore/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Encore/resonanceChains.ts). TL source: [1203.review.json](../src/game-data/mechanics-reviews/3.7/1203.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | Fusion 0.03 (up to 4 stacks) | stacks ≤4: add-damage-bonus 0.03 | Both |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | talentModifierMultiply 0.4 → 2 talent(s) | always: increase-motion-value 0.4 → 3 action(s) | Both |
| S4 | Fusion 0.2 | toggle: add-damage-bonus 0.2 (team) | Both |
| S5 | ResonanceSkillDMGBonus 0.35 | always: add-damage-bonus 0.35 | Both |
| S6 | ATK 0.05 (up to 5 stacks) | stacks ≤5: add-percent-stat atk 0.05 | Both |

## Galbrena (1208)

WT source: [Galbrena/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Galbrena/resonanceChains.ts). TL source: [1208.review.json](../src/game-data/mechanics-reviews/3.7/1208.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | toggle: add-flat-stat critDamage 0.02 → 15 action(s) | TL only |
| S2 | No declared modifier | always: add-percent-stat atk 3.5 | TL only |
| S3 | talentModifierMultiply 1.3 → 1 talent(s) | toggle: increase-motion-value 1.3 → 1 action(s) | Both |
| S4 | Fusion 0.2; Glacio 0.2; Electro 0.2; Aero 0.2; Havoc 0.2; Spectro 0.2 | toggle: add-damage-bonus 0.2 (team) | Both |
| S5 | talentModifierMultiply 1.5 → 3 talent(s) | toggle: increase-motion-value 1.5 → 3 action(s) | Both |
| S6 | talentModifierMultiply 0.6 → 11 talent(s) | toggle: amplify-damage 0.00875 | Both |

## Hiyuki (1108)

WT source: [Hiyuki/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Hiyuki/resonanceChains.ts). TL source: [1108.review.json](../src/game-data/mechanics-reviews/3.7/1108.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | talentModifierMultiply 1.2 → 11 talent(s) | toggle: increase-motion-value 1.2 → 10 action(s) | Both |
| S2 | talentModifierMultiply 1.25 → 1 talent(s) | always: increase-motion-value 1.25 → 1 action(s) | Both |
| S3 | talentModifierMultiply 1.6 → 2 talent(s); talentModifierMultiply 4.88 → 1 talent(s) | toggle: increase-motion-value 1.6 → 2 action(s) / toggle: increase-motion-value 4.88 → 1 action(s) | Both |
| S4 | DMGBonus 0.2; EnableAttack SequenceNode4LikeReedsonTides | toggle: add-damage-bonus 0.2 → 8 action(s) (team) | Both |
| S5 | talentModifierMultiply 0.8 → 3 talent(s) | toggle: increase-motion-value 0.8 → 3 action(s) | Both |
| S6 | CritDMG 5 → 2 talent(s) | stacks ≤2: add-flat-stat critDamage 0.4 | Both |

## Hsin (1311)

WT source: [Hsin/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Hsin/resonanceChains.ts). TL review: pending; no approved `1311.review.json` exists. See [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier / Unison: talentModifierMultiply 0.15 → 2 talent(s) | No generated sequence effect | Unreviewed |
| S2 | talentModifierMultiply 0.6 → 4 talent(s) | No generated sequence effect | Unreviewed |
| S3 | talentModifierMultiply 0.7 → 1 talent(s) / Unison: CritDMG 0.2 → 1 talent(s) / Electro Flare: EnableAttack SequenceNode3ADreamOfReturnAmongTheHillsElectroFlare | No generated sequence effect | Unreviewed |
| S4 | AllElementAttributeBonus 0.2 | No generated sequence effect | Unreviewed |
| S5 | No declared modifier | No generated sequence effect | Unreviewed |
| S6 | specialMultiplier 0.4 → 10 talent(s); DEFIgnore 0.2 → 10 talent(s) / Unison: No declared modifier / Electro Flare: CritRate 0.8 → 4 talent(s); CritDMG 1.3 → 4 talent(s) | No generated sequence effect | Unreviewed |

## Iuno (1410)

WT source: [Iuno/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Iuno/resonanceChains.ts). TL source: [1410.review.json](../src/game-data/mechanics-reviews/3.7/1410.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | ATK 0.4 | toggle: add-percent-stat atk 0.4 | Both |
| S2 | DMGDeepen 0.4 | stacks ≤10: amplify-damage 0.4 (team) | Both |
| S3 | DMGDeepen 0.65 → 10 talent(s) | toggle: amplify-damage 0.65 → 10 action(s) | Both |
| S4 | EnableAttack SequenceNode4RainySeasonDwellinMyEyes | No generated sequence effect | WT only |
| S5 | ResonanceLiberationDMGBonus 0.2 | always: add-damage-bonus 0.2 | Both |
| S6 | talentModifierMultiplyAdd 16 → 1 talent(s) | always: increase-motion-value 16 → 1 action(s) | Both |

## Jianxin (1405)

WT source: [Jianxin/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Jianxin/resonanceChains.ts). TL source: [1405.review.json](../src/game-data/mechanics-reviews/3.7/1405.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | No declared modifier | No generated sequence effect | Neither |
| S4 | targeted multiplier 0.8 → 2 talent(s) | toggle: add-damage-bonus 0.8 → 1 action(s) | Both |
| S5 | No declared modifier | No generated sequence effect | Neither |
| S6 | EnableAttack SequenceNode6TruthfromWithinSpecialChiCounter | toggle: 1 triggered action(s) | Both |

## Jingran (1212)

WT source: [Jingran/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Jingran/resonanceChains.ts). TL source: [1212.review.json](../src/game-data/mechanics-reviews/3.7/1212.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | talentModifierMultiply 0.8 → 6 talent(s) | toggle: increase-motion-value 0.8 → 4 action(s) | Both |
| S2 | talentModifierMultiply 0.46 → 2 talent(s) / DMGDeepen 1.8 → 2 talent(s) | toggle: increase-motion-value 0.46 → 2 action(s) | Both |
| S3 | ATK_FLAT:AdditionalBase 50 | value ≤50: add-flat-stat atk 50 | Both |
| S4 | AllElementAttributeBonus 0.2 | toggle: add-damage-bonus 0.2 (team) | Both |
| S5 | No declared modifier | No generated sequence effect | Neither |
| S6 | specialMultiplier:Heavy 0.4; talentModifierMultiply 0.4 → 1 talent(s) | always: increase-motion-value 0.8 → 1 action(s) | Both |

## Jinhsi (1304)

WT source: [Jinhsi/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Jinhsi/resonanceChains.ts). TL source: [1304.review.json](../src/game-data/mechanics-reviews/3.7/1304.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | targeted multiplier 0.2 → 2 talent(s) (up to 4 stacks) | No generated sequence effect | WT only |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | ATK 0.25 (up to 2 stacks) | stacks ≤2: add-percent-stat atk 0.25 | Both |
| S4 | AllElementAttributeBonus 0.2 | toggle: add-damage-bonus 0.2 (team) | Both |
| S5 | talentModifierMultiply 1.2 → 1 talent(s) | toggle: increase-motion-value 1.2 → 1 action(s) | Both |
| S6 | talentModifierMultiply 0.45 → 2 talent(s) | toggle: increase-motion-value 0.45 → 2 action(s) | Both |

## Jiyan (1404)

WT source: [Jiyan/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Jiyan/resonanceChains.ts). TL source: [1404.review.json](../src/game-data/mechanics-reviews/3.7/1404.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | ATK 0.28 | toggle: add-percent-stat atk 0.28 | Both |
| S3 | CritRate 0.16; CritDMG 0.32 | toggle: add-flat-stat critRate 0.16 → 1 action(s); add-flat-stat critDamage 0.32 → 1 action(s) | Both |
| S4 | HeavyAttackDMGBonus 0.25 | toggle: add-damage-bonus 0.25 (team) | Both |
| S5 | talentModifierMultiply 1.2 → 1 talent(s) / ATK 0.03 (up to 15 stacks) | stacks ≤15: add-percent-stat atk 0.03 | Both |
| S6 | talentModifierMultiply 1.2 → 1 talent(s) (up to 2 stacks) | stacks ≤1: increase-motion-value 1.2 → 1 action(s) | Both |

## Lingyang (1104)

WT source: [Lingyang/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Lingyang/resonanceChains.ts). TL source: [1104.review.json](../src/game-data/mechanics-reviews/3.7/1104.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No chain entry | No generated sequence effect | Neither |
| S2 | No chain entry | No generated sequence effect | Neither |
| S3 | BasicAttackDMGBonus 0.2; ResonanceSkillDMGBonus 0.1 | toggle: add-damage-bonus 0.2; add-damage-bonus 0.1 | Both |
| S4 | Glacio 0.2 | toggle: add-damage-bonus 0.2 (team) | Both |
| S5 | EnableAttack SequenceNode5SevenStarsShineSteppeduponHigh | toggle: 1 triggered action(s) | Both |
| S6 | targeted multiplier 1 → 4 talent(s) | toggle: add-damage-bonus 1 | Both |

## Lucilla (1109)

WT source: [Lucilla/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Lucilla/resonanceChains.ts). TL source: [1109.review.json](../src/game-data/mechanics-reviews/3.7/1109.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 0.2 | toggle: add-flat-stat critRate 0.2 → 1 action(s) | Both |
| S2 | Glacio Chafe: DMGDeepen:GlacioChafe 0.8 / Echo: EchoDMGBonus 0.4 | toggle: amplify-damage 0.8 / toggle: add-damage-bonus 0.4 (team) | Both |
| S3 | talentModifierMultiply 1 → 1 talent(s) | always: increase-motion-value 1 → 1 action(s) | Both |
| S4 | ATK 0.1 (up to 3 stacks) | stacks ≤1: add-percent-stat atk 0.1 | Both |
| S5 | talentModifierMultiply 0.5 → 1 talent(s) | always: increase-motion-value 0.5 → 1 action(s) | Both |
| S6 | targeted multiplier 2 → 1 talent(s) (up to 3 stacks) | stacks ≤1: add-damage-bonus 2 → 1 action(s) | Both |

## Lucy (1511)

WT source: [Lucy/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Lucy/resonanceChains.ts). TL source: [1511.review.json](../src/game-data/mechanics-reviews/3.7/1511.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | ATK 0.2 | toggle: add-percent-stat atk 0.2 | Both |
| S2 | EnableAttack SequenceNode2TheBlackwallthePasttheEscape | toggle: 1 triggered action(s) / toggle: increase-motion-value 2.7 → 1 action(s) | Both |
| S3 | talentModifierMultiply 0.5 → 2 talent(s); CritDMG 1 → 2 talent(s); talentModifierMultiply 0.65 → 2 talent(s) | always: increase-motion-value 0.65 → 1 action(s) / always: increase-motion-value 0.65 → 1 action(s) | Both |
| S4 | Fusion 0.2; Electro 0.2; Havoc 0.2; Spectro 0.2; Aero 0.2; Glacio 0.2 | toggle: add-damage-bonus 0.2 (team) | Both |
| S5 | EnableAttack SequenceNode5ABrokenPathtoHell | No generated sequence effect | WT only |
| S6 | specialMultiplier:Heavy 0.4; specialMultiplier:Hack 0.6 | always: add-damage-bonus 0.6 | Both |

## Lumi (1504)

WT source: [Lumi/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Lumi/resonanceChains.ts). TL source: [1504.review.json](../src/game-data/mechanics-reviews/3.7/1504.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | DEFIgnore 0.2 → 2 talent(s) | always: ignore-defense 0.2 → 2 action(s) | Both |
| S3 | targeted multiplier 0.3 → 1 talent(s) | always: add-damage-bonus 0.3 → 1 action(s) | Both |
| S4 | BasicAttackDMGBonus 0.3 | always: add-damage-bonus 0.3 | Both |
| S5 | talentModifierMultiply 1 → 1 talent(s) | toggle: add-damage-bonus 1 → 1 action(s) | Both |
| S6 | ATK 0.2 | toggle: add-percent-stat atk 0.2 (team) | Both |

## Lupa (1207)

WT source: [Lupa/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Lupa/resonanceChains.ts). TL source: [1207.review.json](../src/game-data/mechanics-reviews/3.7/1207.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 0.2 | toggle: add-flat-stat critRate 0.2 | Both |
| S2 | Fusion 0.2 (up to 2 stacks) | stacks ≤2: add-damage-bonus 0.2 (team) | Both |
| S3 | talentModifierMultiply 1 → 1 talent(s) / ResistIgnore:Fusion 0.15 | always: increase-motion-value 1 → 1 action(s) | Both |
| S4 | talentModifierMultiply 1.25 → 1 talent(s) | always: increase-motion-value 1.25 → 2 action(s) | Both |
| S5 | ResonanceLiberationDMGBonus 0.15 | toggle: add-damage-bonus 0.15 | Both |
| S6 | DEFIgnore 0.3 → 3 talent(s); AppendAnotherTalent PackHuntFusionTeam, PackHuntFusionEnhanced, InherentSkillApplauseofVictory, InherentSkillApplauseofVictoryFullFusionTeam → 1 talent(s) | always: ignore-defense 0.3 → 3 action(s) | Both |

## Luuk Herssen (1510)

WT source: [LuukHerssen/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/LuukHerssen/resonanceChains.ts). TL source: [1510.review.json](../src/game-data/mechanics-reviews/3.7/1510.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | targeted multiplier 1.5 → 8 talent(s) | always: add-damage-bonus 1.5 → 2 action(s) | Both |
| S2 | talentModifierMultiply 0.6 → 1 talent(s) | toggle: amplify-damage 0.1 / always: amplify-damage 0.6 | Both |
| S3 | talentModifierMultiply 1.36 → 3 talent(s); talentModifierMultiply 1.36 → 2 talent(s) | always: add-damage-bonus 1.36 → 3 action(s) | Both |
| S4 | DMGBonus 0.2 | toggle: amplify-damage 0.2 (team) | Both |
| S5 | targeted multiplier 0.8 → 2 talent(s); talentModifierMultiply 0.5 → 1 talent(s) | always: increase-motion-value 0.5 → 1 action(s) | Both |
| S6 | specialMultiplier 0.3 → 5 talent(s) | toggle: amplify-damage 0.3 → 5 action(s) / stacks ≤3: add-damage-bonus 0.4 → 1 action(s) | Both |

## Lynae (1509)

WT source: [Lynae/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Lynae/resonanceChains.ts). TL source: [1509.review.json](../src/game-data/mechanics-reviews/3.7/1509.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | talentModifierMultiply 1.2 → 3 talent(s) | always: increase-motion-value 1.2 → 8 action(s) | Both |
| S2 | DMGDeepen 0.25 | always: amplify-damage 0.25 / toggle: amplify-damage 0.25 (next) | Both |
| S3 | talentModifierMultiply 0.9 → 2 talent(s) / Tune Rupture: targeted multiplier 0.55 → 1 talent(s) (up to 25 stacks) | always: increase-motion-value 0.9 → 10 action(s) / stacks ≤1: add-damage-bonus 0.55 | Both |
| S4 | ATK 0.2 | always: add-percent-stat atk 0.2 | Both |
| S5 | talentModifierMultiply 0.7 → 1 talent(s) | always: increase-motion-value 0.7 → 1 action(s) | Both |
| S6 | specialMultiplier 0.3 → 2 talent(s) (up to 3 stacks) | stacks ≤1: add-damage-bonus 0.3 → 10 action(s) / toggle: reduce-damage-taken 0.3 | Both |

## Mornye (1209)

WT source: [Mornye/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Mornye/resonanceChains.ts). TL source: [1209.review.json](../src/game-data/mechanics-reviews/3.7/1209.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | CritDMG:AdditionalBase 0.002 | always: add-flat-stat critDamage 0.002 (team) | Both |
| S3 | No declared modifier | No generated sequence effect | Neither |
| S4 | talentModifierSpecialMultiply 0.3 → 1 talent(s) | toggle: add-flat-stat healingBonus 0.3 → 1 action(s) | Both |
| S5 | talentModifierMultiply 0.4 → 1 talent(s); talentModifierMultiply 1.6 → 1 talent(s) | always: increase-motion-value 1.6 → 1 action(s) | Both |
| S6 | targeted multiplier 4 → 1 talent(s) | toggle: 1 triggered action(s) | Both |

## Mortefi (1204)

WT source: [Mortefi/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Mortefi/resonanceChains.ts). TL source: [1204.review.json](../src/game-data/mechanics-reviews/3.7/1204.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | CritDMG 0.3 → 2 talent(s) | toggle: add-flat-stat critDamage 0.3 → 1 action(s) | Both |
| S4 | No declared modifier | No generated sequence effect | Neither |
| S5 | EnableAttack SequenceNodeFuneraryQuartet | No generated sequence effect | WT only |
| S6 | ATK 0.2 | toggle: add-percent-stat atk 0.2 (team) | Both |

## Phoebe (1506)

WT source: [Phoebe/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Phoebe/resonanceChains.ts). TL source: [1506.review.json](../src/game-data/mechanics-reviews/3.7/1506.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | Absolution: talentModifierMultiplySetValue 4.8 → 1 talent(s) / Confession: talentModifierMultiply 0.9 → 1 talent(s) | toggle: increase-motion-value 0.88235 → 1 action(s) / toggle: increase-motion-value 0.9 → 1 action(s) | Both |
| S2 | Absolution: DMGDeepen:Outro 1.2 / Confession: DMGDeepen:SpectroFrazzle 1.2 | toggle: amplify-damage 1.2 / toggle: amplify-damage 1.2 | Both |
| S3 | Absolution: talentModifierMultiply 0.91 → 1 talent(s) / Confession: talentModifierMultiply 2.49 → 1 talent(s) | toggle: increase-motion-value 0.91 → 2 action(s) / toggle: increase-motion-value 2.49 → 2 action(s) | Both |
| S4 | ResistShred:Spectro 0.1 | toggle: reduce-resistance 0.1 | Both |
| S5 | Spectro 0.12 | toggle: add-damage-bonus 0.12 | Both |
| S6 | ATK 0.1 | toggle: add-percent-stat atk 0.1 | Both |

## Phrolova (1608)

WT source: [Phrolova/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Phrolova/resonanceChains.ts). TL source: [1608.review.json](../src/game-data/mechanics-reviews/3.7/1608.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | talentModifierMultiply 0.8 → 2 talent(s) (up to 4 stacks) | always: increase-motion-value 0.8 → 1 action(s) / always: increase-motion-value 0.8 → 1 action(s) | Both |
| S2 | talentModifierMultiply 0.75 → 1 talent(s) | always: increase-motion-value 0.75 → 1 action(s) / toggle: increase-motion-value 0.75 → 1 action(s) | Both |
| S3 | DMGDeepen:Echo 0.8; talentModifierMultiply 0.8 → 1 talent(s) | always: amplify-damage 0.8 | Both |
| S4 | Fusion 0.2; Glacio 0.2; Electro 0.2; Aero 0.2; Havoc 0.2; Spectro 0.2 | toggle: add-damage-bonus 0.2 (team); add-damage-bonus 0.2 | Both |
| S5 | No declared modifier | toggle: reduce-damage-taken 0.3 | TL only |
| S6 | talentModifierMultiply 0.24 → 3 talent(s); EnableAttack SequenceNode6ANighttoDepartFromEternalRest / specialMultiplier 0.4 → 5 talent(s) / Havoc 0.6 | toggle: 1 triggered action(s) / toggle: add-damage-bonus 0.6 | Both |

## Qingxiao (1413)

WT source: [Qingxiao/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Qingxiao/resonanceChains.ts). TL source: [1413.review.json](../src/game-data/mechanics-reviews/3.7/1413.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 0.16; EnableAttack SequenceNode1LikeCloudsThatMeetAndDriftApart / specialMultiplier 0.04 → 1 talent(s) (up to 25 stacks) | always: add-flat-stat critRate 0.16 | Both |
| S2 | talentModifierMultiply 0.4 → 1 talent(s) | always: increase-motion-value 0.4 → 9 action(s) | Both |
| S3 | CritDMG 1 → 1 talent(s) | stacks ≤1: increase-motion-value 0.03 → 6 action(s) | Both |
| S4 | ATK 0.2 | toggle: add-percent-stat atk 0.2 | Both |
| S5 | talentModifierMultiply 1 → 1 talent(s) | always: increase-motion-value 1 → 1 action(s) | Both |
| S6 | specialMultiplier 0.4 → 4 talent(s) | stacks ≤1: amplify-damage 0.02 / always: amplify-damage 0.05 / always: add-damage-bonus 0.05 | Both |

## Qiuyuan (1411)

WT source: [Qiuyuan/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Qiuyuan/resonanceChains.ts). TL source: [1411.review.json](../src/game-data/mechanics-reviews/3.7/1411.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 0.2 | always: add-flat-stat critRate 0.2 | Both |
| S2 | DMGDeepen:Echo 0.3 | always: amplify-damage 0.3 (team) | Both |
| S3 | talentModifierMultiplyAdd 5 → 1 talent(s); EnableAttack SequenceNode3OBladeIWhoSaveNoMore, SequenceNode3OBladeIWhoSaveNoMore2 / talentModifierMultiplyAdd 6 → 3 talent(s) | always: increase-motion-value 6 → 3 action(s) | Both |
| S4 | ATK 0.2 | always: add-percent-stat atk 0.2 | Both |
| S5 | DEFIgnore 0.15 | toggle: ignore-defense 0.15 | Both |
| S6 | EnableAttack SequenceNode6ThusIHeardThusISawThusISpoke / CritDMG 1 | toggle: add-flat-stat critDamage 1 | Both |

## Rebecca (1308)

WT source: [Rebecca/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Rebecca/resonanceChains.ts). TL source: [1308.review.json](../src/game-data/mechanics-reviews/3.7/1308.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | talentModifierMultiply 0.5 → 13 talent(s) | always: add-damage-bonus 0.5 | Both |
| S2 | Fusion 0.2; Electro 0.2; Havoc 0.2; Spectro 0.2; Aero 0.2; Glacio 0.2 / DMGDeepen 0.15 | toggle: add-damage-bonus 0.2 (team) / toggle: amplify-damage 0.15 (team) | Both |
| S3 | talentModifierMultiply 0.6 → 4 talent(s) | toggle: increase-motion-value 0.6 → 4 action(s) | Both |
| S4 | No declared modifier | No generated sequence effect | Neither |
| S5 | BasicAttackDMGBonus 0.2 | toggle: add-damage-bonus 0.2 | Both |
| S6 | EnableAttack SequenceNode6MaybeJustMaybe | toggle: 1 triggered action(s) | Both |

## Roccia (1606)

WT source: [Roccia/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Roccia/resonanceChains.ts). TL source: [1606.review.json](../src/game-data/mechanics-reviews/3.7/1606.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | Havoc 0.1 (up to 3 stacks) / Havoc 0.1 | stacks ≤3: add-damage-bonus 0.1 (team) / stacks ≤1: add-damage-bonus 0.1 (team) | Both |
| S3 | CritRate 0.1; CritDMG 0.3 | toggle: add-flat-stat critRate 0.1 | Both |
| S4 | talentModifierMultiply 0.6 → 4 talent(s) | toggle: increase-motion-value 0.6 → 3 action(s) | Both |
| S5 | talentModifierMultiply 0.2 → 1 talent(s); talentModifierMultiply 0.8 → 1 talent(s) | always: increase-motion-value 0.2 → 1 action(s) | Both |
| S6 | DEFIgnore 0.6 → 4 talent(s); EnableAttack SequenceNode6WhentheGoldenWingsFlyDMG | always: ignore-defense 0.6 | Both |

## Rover: Aero (Male) (1406)

WT source: [RoverAeroFemale/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/RoverAeroFemale/resonanceChains.ts). TL source: [1406.review.json](../src/game-data/mechanics-reviews/3.7/1406.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | EnableAttack SequenceNode2GlimmersFadeintotheDarkHeal1 | toggle: 1 triggered action(s) | Both |
| S3 | Aero 0.15 | always: add-damage-bonus 0.15 | Both |
| S4 | ResonanceSkillDMGBonus 0.15 | toggle: add-damage-bonus 0.15 | Both |
| S5 | talentModifierMultiply 0.2 → 1 talent(s) | toggle: increase-motion-value 0.2 → 1 action(s) | Both |
| S6 | talentModifierMultiply 0.3 → 2 talent(s) | always: increase-motion-value 0.3 → 2 action(s) | Both |

## Rover: Aero (Female) (1408)

WT source: [RoverAeroFemale/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/RoverAeroFemale/resonanceChains.ts). TL source: [1408.review.json](../src/game-data/mechanics-reviews/3.7/1408.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | EnableAttack SequenceNode2GlimmersFadeintotheDarkHeal1 | toggle: 1 triggered action(s) | Both |
| S3 | Aero 0.15 | always: add-damage-bonus 0.15 | Both |
| S4 | ResonanceSkillDMGBonus 0.15 | toggle: add-damage-bonus 0.15 | Both |
| S5 | talentModifierMultiply 0.2 → 1 talent(s) | toggle: increase-motion-value 0.2 → 1 action(s) | Both |
| S6 | talentModifierMultiply 0.3 → 2 talent(s) | always: increase-motion-value 0.3 → 2 action(s) | Both |

## Rover: Electro (Male) (1309)

WT source: [Roverelectrofemale/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Roverelectrofemale/resonanceChains.ts). TL source: [1309.review.json](../src/game-data/mechanics-reviews/3.7/1309.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | talentModifierMultiply 0.2 → 1 talent(s) | always: increase-motion-value 0.2 → 1 action(s) | Both |
| S4 | talentModifierMultiply 0.2 → 1 talent(s) | toggle: increase-motion-value 0.2 → 1 action(s) | Both |
| S5 | CritDMG 0.2 → 29 talent(s) | toggle: add-flat-stat critDamage 0.2 | Both |
| S6 | talentModifierMultiply 0.2 → 15 talent(s) | always: increase-motion-value 0.2 → 1 action(s) | Both |

## Rover: Electro (Female) (1310)

WT source: [Roverelectrofemale/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Roverelectrofemale/resonanceChains.ts). TL source: [1310.review.json](../src/game-data/mechanics-reviews/3.7/1310.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | talentModifierMultiply 0.2 → 1 talent(s) | always: increase-motion-value 0.2 → 1 action(s) | Both |
| S4 | talentModifierMultiply 0.2 → 1 talent(s) | toggle: increase-motion-value 0.2 → 1 action(s) | Both |
| S5 | CritDMG 0.2 → 29 talent(s) | toggle: add-flat-stat critDamage 0.2 | Both |
| S6 | talentModifierMultiply 0.2 → 15 talent(s) | always: increase-motion-value 0.2 → 1 action(s) | Both |

## Rover: Havoc (Female) (1604)

WT source: [RoverHavocFemale/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/RoverHavocFemale/resonanceChains.ts). TL source: [1604.review.json](../src/game-data/mechanics-reviews/3.7/1604.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | ResonanceSkillDMGBonus 0.3 | always: add-damage-bonus 0.3 | Both |
| S2 | No chain entry | No generated sequence effect | Neither |
| S3 | No chain entry | No generated sequence effect | Neither |
| S4 | ResistShred:Havoc 0.1 | toggle: reduce-resistance 0.1 | Both |
| S5 | EnableAttack SequenceNode5AeonSymphony | No generated sequence effect | WT only |
| S6 | CritRate 0.25 → 15 talent(s) | always: add-flat-stat critRate 0.25 | Both |

## Rover: Havoc (Male) (1605)

WT source: [RoverHavocFemale/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/RoverHavocFemale/resonanceChains.ts). TL source: [1605.review.json](../src/game-data/mechanics-reviews/3.7/1605.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | ResonanceSkillDMGBonus 0.3 | always: add-damage-bonus 0.3 | Both |
| S2 | No chain entry | No generated sequence effect | Neither |
| S3 | No chain entry | No generated sequence effect | Neither |
| S4 | ResistShred:Havoc 0.1 | toggle: reduce-resistance 0.1 | Both |
| S5 | EnableAttack SequenceNode5AeonSymphony | No generated sequence effect | WT only |
| S6 | CritRate 0.25 → 15 talent(s) | always: add-flat-stat critRate 0.25 | Both |

## Rover: Spectro (Male) (1501)

WT source: [RoverSpectroFemale/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/RoverSpectroFemale/resonanceChains.ts). TL source: [1501.review.json](../src/game-data/mechanics-reviews/3.7/1501.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 0.15 | toggle: add-flat-stat critRate 0.15 → 2 action(s) | Both |
| S2 | Spectro 0.2 | always: add-damage-bonus 0.2 | Both |
| S3 | EnergyRegen 0.2 | always: add-flat-stat energyRegen 0.2 | Both |
| S4 | EnableAttack SequenceNode4ResonatingLamella | toggle: 1 triggered action(s) | Both |
| S5 | ResonanceLiberationDMGBonus 0.4 | always: add-damage-bonus 0.4 | Both |
| S6 | ResistShred:Spectro 0.1 | toggle: reduce-resistance 0.1 | Both |

## Rover: Spectro (Female) (1502)

WT source: [RoverSpectroFemale/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/RoverSpectroFemale/resonanceChains.ts). TL source: [1502.review.json](../src/game-data/mechanics-reviews/3.7/1502.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 0.15 | toggle: add-flat-stat critRate 0.15 → 2 action(s) | Both |
| S2 | Spectro 0.2 | always: add-damage-bonus 0.2 | Both |
| S3 | EnergyRegen 0.2 | always: add-flat-stat energyRegen 0.2 | Both |
| S4 | EnableAttack SequenceNode4ResonatingLamella | toggle: 1 triggered action(s) | Both |
| S5 | ResonanceLiberationDMGBonus 0.4 | always: add-damage-bonus 0.4 | Both |
| S6 | ResistShred:Spectro 0.1 | toggle: reduce-resistance 0.1 | Both |

## Sanhua (1102)

WT source: [Sanhua/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Sanhua/resonanceChains.ts). TL source: [1102.review.json](../src/game-data/mechanics-reviews/3.7/1102.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 0.15 | toggle: add-flat-stat critRate 0.15 | Both |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | DMGBonus 0.35 | toggle: add-damage-bonus 0.35 | Both |
| S4 | targeted multiplier 1.2 → 1 talent(s) | toggle: add-damage-bonus 1.2 → 1 action(s) | Both |
| S5 | CritDMG 1 → 3 talent(s) | always: add-flat-stat critDamage 1 → 3 action(s) | Both |
| S6 | ATK 0.1 (up to 2 stacks) | stacks ≤2: add-percent-stat atk 0.1 (team) | Both |

## Shorekeeper (1505)

WT source: [Shorekeeper/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Shorekeeper/resonanceChains.ts). TL source: [1505.review.json](../src/game-data/mechanics-reviews/3.7/1505.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | ATK 0.4 | always: add-percent-stat atk 0.4 (team) | Both |
| S3 | No declared modifier | No generated sequence effect | Neither |
| S4 | HealingBonus 0.7 → 1 talent(s) | toggle: add-flat-stat healingBonus 0.7 | Both |
| S5 | No declared modifier | No generated sequence effect | Neither |
| S6 | talentModifierMultiply 0.42 → 1 talent(s) / CritDMG 5 → 1 talent(s) | always: increase-motion-value 0.42 → 2 action(s) / toggle: add-flat-stat critDamage 5 → 2 action(s) | Both |

## Sigrika (1412)

WT source: [Sigrika/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Sigrika/resonanceChains.ts). TL source: [1412.review.json](../src/game-data/mechanics-reviews/3.7/1412.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | talentModifierMultiply 0.7 → 4 talent(s) | toggle: increase-motion-value 0.7 → 4 action(s) | Both |
| S2 | talentModifierMultiply 1.2 → 1 talent(s) | always: increase-motion-value 1.2 → 1 action(s) | Both |
| S3 | No declared modifier | No generated sequence effect | Neither |
| S4 | ATK 0.2 | toggle: add-percent-stat atk 0.2 (team) | Both |
| S5 | talentModifierMultiply 0.3 → 1 talent(s) | toggle: increase-motion-value 0.3 → 1 action(s) | Both |
| S6 | specialMultiplier 0.3 | stacks ≤1: ignore-defense 0.075 → 4 action(s) | Both |

## Suisui (1110)

WT source: [Suisui/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Suisui/resonanceChains.ts). TL source: [1110.review.json](../src/game-data/mechanics-reviews/3.7/1110.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | CritDMG 0.5 | toggle: add-flat-stat critDamage 0.5 | Both |
| S3 | No declared modifier | No generated sequence effect | Neither |
| S4 | HealingBonus 0.5 → 3 talent(s) | toggle: add-flat-stat healingBonus 0.5 → 2 action(s) | Both |
| S5 | talentModifierMultiply 1 → 5 talent(s) | toggle: increase-motion-value 1 → 5 action(s) | Both |
| S6 | CritDMG 5 → 2 talent(s) | toggle: add-flat-stat critDamage 5 → 2 action(s) | Both |

## Suoming (1312)

WT source: [Suoming/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Suoming/resonanceChains.ts). TL source: [1312.review.json](../src/game-data/mechanics-reviews/3.7/1312.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | talentModifierMultiply 0.6 → 4 talent(s) | toggle: increase-motion-value 0.6 → 4 action(s) | Both |
| S2 | CritDMG 0.4 | always: add-flat-stat critDamage 0.4 / toggle: add-flat-stat critDamage 0.1 (next) / stacks ≤4: add-flat-stat critDamage 0.06 (next) | Both |
| S3 | DMGDeepen:Basic 0.3 | toggle: amplify-damage 0.3 | Both |
| S4 | ATK 0.2 | always: add-percent-stat atk 0.2 | Both |
| S5 | talentModifierMultiply 0.4 → 1 talent(s) | toggle: increase-motion-value 0.4 → 1 action(s) | Both |
| S6 | talentModifierMultiply 0.5 → 1 talent(s) | stacks ≤4: amplify-damage 0.045 (team) / toggle: increase-motion-value 0.5 → 1 action(s) / toggle: add-flat-stat critDamage 2 | Both |

## Taoqi (1601)

WT source: [Taoqi/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Taoqi/resonanceChains.ts). TL source: [1601.review.json](../src/game-data/mechanics-reviews/3.7/1601.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | targeted multiplier 0.4 → 3 talent(s) | No generated sequence effect | WT only |
| S2 | CritRate 0.2 → 1 talent(s); CritDMG 0.2 → 1 talent(s) | always: add-flat-stat critRate 0.2 → 1 action(s); add-flat-stat critDamage 0.2 → 1 action(s) | Both |
| S3 | No declared modifier | No generated sequence effect | Neither |
| S4 | DEF 0.5 | toggle: add-percent-stat def 0.5; 1 triggered action(s) | Both |
| S5 | targeted multiplier 0.5 → 3 talent(s) | always: add-damage-bonus 0.5 → 3 action(s) | Both |
| S6 | BasicAttackDMGBonus 0.4; HeavyAttackDMGBonus 0.4 | toggle: add-damage-bonus 0.4; add-damage-bonus 0.4 | Both |

## Verina (1503)

WT source: [Verina/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Verina/resonanceChains.ts). TL source: [1503.review.json](../src/game-data/mechanics-reviews/3.7/1503.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | EnableAttack SequenceNode1MomentofEmergence | No generated sequence effect | WT only |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | targeted multiplier 0.12 → 3 talent(s) | No generated sequence effect | WT only |
| S4 | Spectro 0.15 | toggle: add-damage-bonus 0.15 (team) | Both |
| S5 | HealingBonus 0.2 | toggle: add-flat-stat healingBonus 0.2 | Both |
| S6 | targeted multiplier 0.2 → 4 talent(s); EnableAttack SequenceNode6JoyousHarvest | No generated sequence effect | WT only |

## Xiangli Yao (1305)

WT source: [XiangliYao/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/XiangliYao/resonanceChains.ts). TL source: [1305.review.json](../src/game-data/mechanics-reviews/3.7/1305.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | EnableAttack SequenceNode1ProdigyofProteges | No generated sequence effect | WT only |
| S2 | CritDMG 0.3 | toggle: add-flat-stat critDamage 0.3 → 1 action(s) | Both |
| S3 | targeted multiplier 0.63 → 5 talent(s) | toggle: add-damage-bonus 0.63 → 1 action(s) | Both |
| S4 | ResonanceLiberationDMGBonus 0.25 | toggle: add-damage-bonus 0.25 → 1 action(s) (team) | Both |
| S5 | talentModifierMultiply 1 → 1 talent(s); talentModifierMultiply 2.22 → 1 talent(s) | always: increase-motion-value 1 → 1 action(s) | Both |
| S6 | talentModifierMultiply 0.76 → 2 talent(s) | toggle: increase-motion-value 0.76 → 1 action(s) | Both |

## Yangyang (1402)

WT source: [Yangyang/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Yangyang/resonanceChains.ts). TL source: [1402.review.json](../src/game-data/mechanics-reviews/3.7/1402.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | Aero 0.15 | toggle: add-damage-bonus 0.15 | Both |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | ResonanceSkillDMGBonus 0.4 | always: add-damage-bonus 0.4 | Both |
| S4 | targeted multiplier 0.95 → 1 talent(s) | always: add-damage-bonus 0.95 → 1 action(s) | Both |
| S5 | targeted multiplier 0.85 → 1 talent(s) | always: add-damage-bonus 0.85 → 1 action(s) | Both |
| S6 | ATK 0.2 | toggle: add-percent-stat atk 0.2 (team) | Both |

## Yangyang: Xuanling (1610)

WT source: [YangyangXuanling/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/YangyangXuanling/resonanceChains.ts). TL source: [1610.review.json](../src/game-data/mechanics-reviews/3.7/1610.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | EnableAttack SequenceNode1AtTheWindSBreathTheBlossomsWake | toggle: 1 triggered action(s) | Both |
| S2 | targeted multiplier 1 → 14 talent(s); EnableAttack SequenceNode2RiverCarriesHerSongAway | toggle: 1 triggered action(s) | Both |
| S3 | DMGDeepen 1.75 → 1 talent(s) | always: amplify-damage 1.75 → 1 action(s) | Both |
| S4 | ATK 0.2 | toggle: add-percent-stat atk 0.2 (team) | Both |
| S5 | No declared modifier | No generated sequence effect | Neither |
| S6 | specialMultiplier 0.4 → 18 talent(s); EnableAttack SequenceNode6LetTheAzureKeepItsLight | toggle: amplify-damage 0.4; 1 triggered action(s) / toggle: 1 triggered action(s) | Both |

## Yinlin (1302)

WT source: [Yinlin/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Yinlin/resonanceChains.ts). TL source: [1302.review.json](../src/game-data/mechanics-reviews/3.7/1302.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | targeted multiplier 0.7 → 2 talent(s) | No generated sequence effect | WT only |
| S2 | No chain entry | No generated sequence effect | Neither |
| S3 | talentModifierMultiply 0.55 → 1 talent(s) | always: increase-motion-value 0.55 → 1 action(s) | Both |
| S4 | ATK 0.2 | toggle: add-percent-stat atk 0.2 (team) | Both |
| S5 | targeted multiplier 1 → 1 talent(s) | No generated sequence effect | WT only |
| S6 | EnableAttack SequenceNode6PursuitofJustice | toggle: 1 triggered action(s) | Both |

## Youhu (1106)

WT source: [Youhu/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Youhu/resonanceChains.ts). TL source: [1106.review.json](../src/game-data/mechanics-reviews/3.7/1106.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | MultiplySelfBuff 2 → 1 talent(s) | toggle: add-damage-bonus 0.7 → 1 action(s) / toggle: add-damage-bonus 1.75 → 1 action(s) | Both |
| S3 | ATK 0.2 | always: add-percent-stat atk 0.2 | Both |
| S4 | No declared modifier | No generated sequence effect | Neither |
| S5 | CritRate 0.15 | toggle: add-flat-stat critRate 0.15 | Both |
| S6 | CritDMG 0.15 (up to 4 stacks) | stacks ≤4: add-flat-stat critDamage 0.15 | Both |

## Yuanwu (1303)

WT source: [Yuanwu/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Yuanwu/resonanceChains.ts). TL source: [1303.review.json](../src/game-data/mechanics-reviews/3.7/1303.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | No declared modifier | No generated sequence effect | Neither |
| S2 | No declared modifier | No generated sequence effect | Neither |
| S3 | Talent [object Object] | No generated sequence effect | WT only |
| S4 | EnableAttack SequenceNode4RetributiveKnuckles | No generated sequence effect | WT only |
| S5 | ResonanceLiberationDMGBonus 0.5 | toggle: add-damage-bonus 0.5 | Both |
| S6 | DEF 0.32 | toggle: add-percent-stat def 0.32 (team) | Both |

## Zani (1507)

WT source: [Zani/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Zani/resonanceChains.ts). TL source: [1507.review.json](../src/game-data/mechanics-reviews/3.7/1507.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | Spectro 0.5 | toggle: add-damage-bonus 0.5 | Both |
| S2 | CritRate 0.2; talentModifierMultiply 0.8 → 2 talent(s) | always: add-flat-stat critRate 0.2 / always: increase-motion-value 0.8 → 2 action(s) | Both |
| S3 | talentModifierMultiplyAdd 0.08 → 1 talent(s) (up to 150 stacks) | toggle: increase-motion-value 0.08 → 1 action(s) | Both |
| S4 | ATK 0.2 | toggle: add-percent-stat atk 0.2 (team) | Both |
| S5 | talentModifierMultiply 1.2 → 1 talent(s) | always: increase-motion-value 1.2 → 1 action(s) | Both |
| S6 | talentModifierMultiply 0.4 → 4 talent(s) | always: increase-motion-value 0.4 → 1 action(s) | Both |

## Zhezhi (1105)

WT source: [Zhezhi/resonanceChains.ts](../.codex-work/combat-reference-3.7/src/characters/Zhezhi/resonanceChains.ts). TL source: [1105.review.json](../src/game-data/mechanics-reviews/3.7/1105.review.json), [generated mechanics](../src/game-data/combat/reviewed-mechanics.generated.ts).

| Sequence | reference implementation declaration | Tacet Lab generated effect | Difference |
|---|---|---|---|
| S1 | CritRate 0.1 | toggle: add-flat-stat critRate 0.1 → 1 action(s) | Both |
| S2 | No chain entry | No generated sequence effect | Neither |
| S3 | ATK 0.15 (up to 3 stacks) | stacks ≤3: add-percent-stat atk 0.15 | Both |
| S4 | ATK 0.2 | toggle: add-percent-stat atk 0.2 | Both |
| S5 | EnableAttack SequenceNode5CompositionsClue | No generated sequence effect | WT only |
| S6 | EnableAttack SequenceNode6InfiniteLegacy | No generated sequence effect | WT only |
