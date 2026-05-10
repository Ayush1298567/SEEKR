# SEEKR Build Backlog

Created: 2026-05-04  
Rule: do not skip ahead to hardware command authority.

## Strict Order

| Order | Item | Output | Done When |
|---:|---|---|---|
| 1 | Full research dossier and section decisions | `SEEKR_*` decision docs | Docs include source-backed decisions and pushback |
| 2 | Zod schemas and envelopes | `src/shared/schemas.ts`, `envelopes.ts` | Typecheck passes |
| 3 | Append-only mission events | Event store with seq/hash | Events are ordered and hash-chained |
| 4 | Reducer/read model | `missionReducer.ts` | State rebuilds from events |
| 5 | Deterministic simulator | Seeded simulator clock/RNG | Same scenario/seed stable |
| 6 | Command pipeline | `POST /api/commands` | UI actions create lifecycle events |
| 7 | AI approval pipeline | AI proposals approve into normal commands | AI has no mutation path |
| 8 | Replay/export bundle | Replay manifest and endpoint | Replay final state matches |
| 9 | Hash-chained persistence | NDJSON event persistence | Tamper test passes |
| 10 | Map fusion | Confidence/source/conflict cells | Conflicts/stale cells visible |
| 11 | Frontier allocator/task ledger | Zone/task assignment logic | Dropout creates reassignment path |
| 12 | UI layers/command review | Map layers and modal | Operator sees command impact |
| 13 | Replay timeline UI | Play/pause/seek/speed | Seek reconstructs state |
| 14 | Evidence model/UI | Evidence assets and detection detail | Detection review has evidence context |
| 15 | MAVLink fixture mapping | Read-only telemetry normalizer | Fixture test passes |
| 16 | ROS 2 map/detection mapping | Map/detection normalizers | Fixture tests pass |
| 17 | API/WebSocket tests | Contract tests | Initial snapshot/seq/reconnect pass |
| 18 | Playwright smoke tests | UI workflow checks | Load/start/review/propose/replay/export pass |
| 19 | Safety/regulatory/security docs | Safety package | Critical hazards covered |
| 20 | Mission report export | Evidence package | Hashes and metadata included |
| 21 | Guarded hold/RTH upload | Real adapter command gate | Safety case and bench tests pass |
| 22 | Waypoint/focused-search upload | Expanded command class | Hold/RTH proven first |
| 23 | Aircraft purchase decision | Hardware decision memo | Read-only hardware tests complete |

## Current Sprint Scope

- Complete items 1-9 and meaningful portions of 10-16 in the local TypeScript scaffold.
- Keep real MAVLink/ROS adapters read-only/fixture-based.
- Do not add real command upload.
