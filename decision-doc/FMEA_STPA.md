# SEEKR FMEA / STPA Notes

Created: 2026-05-04

## FMEA Summary

| Function | Failure Mode | Effect | Detection | Mitigation | Test |
|---|---|---|---|---|---|
| Command validation | Unsafe command accepted | Aircraft retasked unsafely | Lifecycle/audit review | Validator matrix and command class gates | Validator tests |
| Event persistence | Event lost or reordered | Replay/evidence invalid | Seq/hash mismatch | Append-only NDJSON and hash chain | Persistence tests |
| Simulator | Nondeterministic scenario | Tests cannot prove regression | Byte-stability failure | Seeded RNG and sim clock | Determinism tests |
| Map fusion | Contradictory maps overwritten | Operator trusts bad map | Conflict cell count | Flag conflicts, do not silently overwrite | Map tests |
| AI proposal | Prompt injection/tool misuse | Unauthorized command attempt | Tool call audit | Draft-only tools, approval pipeline | AI boundary tests |
| MAVLink ingest | Malformed telemetry accepted | Wrong vehicle state | Zod/normalizer checks | Reject malformed fixtures | Adapter tests |
| Evidence export | Hash/evidence mismatch | Incident package unreliable | Hash validation | Evidence asset hash/index | Export tests |

## STPA Unsafe Control Actions

- A command is issued to an offline/failed drone.
- A movement command is issued when estimator quality is below threshold.
- A focused search is issued outside the mission map or inside a no-fly zone.
- Multiple drones are sent to the same detection without approval.
- A stale AI proposal is approved after mission context changes.
- A real adapter accepts command upload before its command class is safety-reviewed.

## Control Constraints

- All commands use `POST /api/commands`.
- AI approvals convert to normal command requests.
- Real adapters remain read-only until safety gates pass.
- Flight-controller failsafes remain authoritative.
