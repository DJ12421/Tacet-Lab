# Stateful combat coverage

The engine and kit source in this directory is adapted from
[Riley31415/wuwa_calc](https://github.com/Riley31415/wuwa_calc), whose
`package.json` identifies its license as ISC. Keep that provenance with any
redistribution of this directory.

The Rotation editor runs a separate stateful kit estimate at saved 60 Hz cast
timestamps. It uses authored kit actions, queues hits at their landing frames,
and runs equipment, gauges, cooldowns, buffs, and enemy debuffs in one fight.
Rotation starts with zero transient enemy status stacks and ignores saved manual
combat conditions and authored buffs; kit actions apply their own effects over
the timeline.
Automatic action matching is limited to casts in the equipped kit's authored
rotation. Imported timing data must match hit count, motion value, frame,
element, damage type, and scaling. Where timing data is absent, the level 10
catalog hit values must uniquely match an authored cast with non-placeholder
timing.

The estimate reports normal, critical, and expected damage and whether every
saved cast and team member was covered.
Partial damage is never added to the formula total. Rotation shows a stateful
total only when every saved cast and equipped member is covered; otherwise its
automatic total is unavailable and formula breakdowns remain separately labeled.
Other team views and optimizer scoring still use formula results. The Theorizer uses stateful
rotation scores only when the baseline and every suggestion have complete
coverage; otherwise its entire ranking uses formula scores.

## Coverage gate

| Area | Supported | Unavailable |
| --- | --- | --- |
| Kits | Kit loadouts present in this module; mapped actions in their selected rotation | Missing or ambiguous action mapping, and catalog attacks outside the authored rotation |
| Levels | Owned character and weapon base stats; owned skill curves matching a level 10 action; negative status and Tune levels present in the local tables | Unreviewed triggered scaling or levels absent from the tables |
| Gear | Equipped source-defined weapon/refinement, main Echo, and active Sonata pieces; owned panel stats | Gear absent from the source definitions or ambiguous kit modes |
| Enemy | Cost 4, level, base resistance, global damage reduction, DEF reduction, DEF ignore, RES ignore, initial negative-status, Electro Rage, and Havoc Bane stacks within each base cap | Other costs, Tune Strain, and preset stacks above a status's base cap |
| Timeline | Saved cast frames, natural animations, default swap delay, delayed hits, and queued kit effects | Overlaps, shifted casts, clips shorter than the authored animation, explicit cancel and swap frames |
| Manual inputs | Direct preview callers can supply self, team, and next-member buffs triggered by mapped casts | Rotation ignores saved manual buffs and conditions |

The damage values and kit behavior have not been verified against the current
English in-game UI. A covered run is a complete simulation of its mapped
casts, not authoritative game verification.
Some kit comments refer to a rules document that is not included in this
module; those assumptions require a separate review before authoritative use.

## Remaining integration

1. Review every action crosswalk and gear mode against the current game data.
2. Map manual conditions, Tune Strain, extended preset stack caps, healing, and shields.
3. Add hand-calculated, multi-character fixtures for buff timing, delayed
   hits, equipment, sequences, and enemy modifiers.
4. Move team totals and optimizer ranking to stateful scoring only when their
   complete result surfaces and candidate sets are covered at the requested
   result mode. Keep formula scoring for unsupported builds.
5. Replay imported cancel modes and exact cancel/swap frames before comparing
   dense WuwaLAB rotations with automatic totals.
