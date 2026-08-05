# Optimizer benchmark

The optimizer benchmark uses deterministic 40, 60, 100, 250, and 500-Echo inventories with mixed costs, Sonata sets, main stats, five substats, locked inventory items, a current-main requirement, stat constraints, and a damage objective. It separately measures 500-Echo plan compilation, a complete 60-Echo exact search, 100k capped searches, and a 1m capped search.

Run it explicitly with:

```powershell
npm run benchmark:optimizer
```

Record planning time, wall time, evaluated builds per second, pruned combinations by reason, work-unit count, per-worker busy time, tail-idle percentage, worker-message bytes, cancellation latency, peak memory, browser, CPU, worker count, and commit hash. Compare exact runs only when the reported search state is `complete`; capped runs measure best-found throughput and must not be presented as proof of optimality.

For a release comparison, capture the same saved profile and inventory on the baseline and candidate commits in current Chrome and Edge. Run 1, 2, 4, and 8 workers, discard the first warm-up run, and report the median of five runs. The acceptance gate is identical exact top-N output plus a visible wall-time improvement, not a higher raw evaluation count caused by weaker pruning.

The benchmark is intentionally separate from the normal test suite because its results depend on hardware and it exercises production-sized inventories.
