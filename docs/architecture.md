# Architecture

## Runtime boundaries

Tacet Lab is a static React application. It has no server runtime.

```text
Screen share / screenshot / local video
  -> resolution and layout calibration profile
  -> stable frame sampler and fingerprint gate
  -> OffscreenCanvas preprocessing worker
  -> named field regions
  -> adaptive English Tesseract scheduler pool and visual classifiers
  -> candidate validation and local duplicate detection
  -> typed review candidate with field evidence
  -> explicit user approval
  -> Dexie / IndexedDB
  -> pure calculation modules
  -> optimizer Web Worker
  -> React views and local PNG/JSON exports
```

## Modules

- `src/domain/` owns serializable types, the tagged formula graph, calculation contexts and traces, stat aggregation, rotations, buffs, and optimization. Domain functions do not access the DOM or storage.
- `src/game-data/` owns the pinned Nanoka 3.5 display and numeric source data. `src/domain/calculation/sheets.ts` classifies every generated character, weapon, Sonata, and Echo record for formula coverage.
- `src/scanner/` owns local capture sources, calibration profiles, named field regions, worker preprocessing, the adaptive English OCR pool, session cancellation/backpressure, parsing, validation, duplicate detection, diagnostics, and fixture accuracy/performance accounting.
- `src/storage/` owns IndexedDB tables, seed repair, schema validation, atomic import, export, and reset.
- `src/workers/` isolates expensive optimization from the render thread. Scanner image preprocessing runs in `src/scanner/preprocess.worker.ts`; Tesseract workers are serialized through one-worker schedulers managed by `OcrPool`.

## Scanner privacy and ordering

Captured images, videos, field crops, OCR text, and diagnostic evidence remain in browser memory. Calibration profiles are stored in local storage and approved Echoes continue to use IndexedDB. Diagnostic reports omit images unless the user explicitly chooses the image-inclusive action.

Text-field preprocessing is clean-room and WuWa-specific. Named regions are padded, enlarged, converted to grayscale, percentile-normalized, polarity-corrected, adaptively thresholded, lightly morphologically closed, and rendered as black text on a white background. The alternate retry uses global Otsu thresholding. Icon and color classifiers retain color input.

Every scan carries a session ID, frame sequence, frame ID, region ID, and job ID. Stopped sessions reject pending work and ignore late results. Live capture replaces obsolete queued frames, video decoding waits for capacity, and screenshots always run to completion. Candidate delivery preserves source sequence.
- `src/ui/` owns application state projection and workflows. UI code calls domain/storage modules but does not define damage formulas.

## Persistence

`AccountDocument` is the portable public format. Schema 3 adds saved team calculation scenarios, formula target IDs, and per-action inputs. Schema-1 and schema-2 backups remain importable. Every export includes `schemaVersion`, `gameDataVersion`, and `exportedAt`; imports are deeply validated before an atomic replacement transaction starts.

## Formula engine

`src/domain/calculation/` retains the original clean-room declarative engine for backward compatibility. The active Team damage path lives in `src/domain/calculation-v2/`: a GPL-compatible, source-attributed mechanics engine whose generated character, weapon, Sonata, Echo, sequence, and party effects feed member result sheets, rotation actions, and optimizer objectives through one calculation context.

Formula data is labeled `nanoka-3.5-formula-v2`. This is reproducible from the pinned dataset; it is not a claim of independent verification against the live game.

## Optimizer

The optimizer filters excluded/assigned items, applies locked items first, and explores every legal candidate in deterministic order without truncating cost groups. It enforces five Echoes, 12 total cost, optional five-piece Sonata, min/max calculated stats, and formula targets. Completed searches are exact for the supplied inventory and constraints. A search that reaches its visited-node budget is labeled `best found`, never as a global optimum.

## Offline behavior

The PWA precaches built application assets. Previously requested Tesseract worker, WASM, and English model resources are cached with a one-year CacheFirst policy. The first OCR run therefore requires network access; later runs can use the cached resources.
