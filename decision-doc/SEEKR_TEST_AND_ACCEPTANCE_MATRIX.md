# SEEKR Test And Acceptance Matrix

Created: 2026-05-04  
Scope: V1 local-first simulator/GCS/replay platform, then read-only integration fixtures.

## Automated Tests

| ID | Test | Requirement | Acceptance |
|---|---|---|---|
| T-001 | Reducer golden state | Event log rebuilds mission state | Same events produce same state JSON |
| T-002 | Command lifecycle | Every operator action goes requested -> validated/rejected -> approved -> dispatched -> accepted/failed | Lifecycle events exist and are ordered |
| T-003 | Battery reserve validator | Prevent unsafe retask | Drone near reserve cannot accept assignment/focused search |
| T-004 | Geofence validator | Prevent out-of-bounds commands | Focused-search outside map/no-fly zone rejected |
| T-005 | Estimator validator | Prevent low-localization commands | Low estimator quality blocks movement commands |
| T-006 | Link validator | Warn/block unsafe link conditions | Degraded link warns, offline blocks |
| T-007 | Offline/failed validator | Prevent command to unavailable drones | Offline/failed drone commands rejected |
| T-008 | No-fly validator | Respect local no-fly zones | Command intersecting no-fly zone rejected |
| T-009 | Clustering validator | Avoid unsafe detection convergence | More than allowed drones near focus point rejected |
| T-010 | Stale proposal validator | Prevent old AI command approval | Proposal older than TTL rejected |
| T-011 | Simulator determinism | Seeded scenario stable | Same seed/scenario creates byte-stable simulator events |
| T-012 | Drone dropout | Reassignment workflow | Dropped drone's zone becomes incomplete/eligible |
| T-013 | Detection seed | Immutable detection and alert | Detection event and P1/P2 alert appear once |
| T-014 | Low battery fault | Return/hold policy | Low battery triggers alert and return/hold action |
| T-015 | Link loss fault | Configured policy | Drone state follows scenario policy |
| T-016 | Replay reconstruction | Evidence replay | Replay final state equals stored final snapshot |
| T-017 | Append-only ordering | Persistence | Event seq is monotonic and no overwrite occurs |
| T-018 | Hash-chain tamper detection | Evidence integrity | Modified event fails validation |
| T-019 | Snapshot restore | Persistence | Latest snapshot loads and matches state seq |
| T-020 | API contract | HTTP schema | Required endpoints validate request/response |
| T-021 | WebSocket initial snapshot | Reconnect behavior | First message is `state.snapshot` envelope |
| T-022 | WebSocket monotonic seq | UI state ordering | Envelope seq never decreases |
| T-023 | MAVLink fixture | Read-only telemetry | HEARTBEAT/BATTERY/POSE/ESTIMATOR/LINK normalize to `TelemetrySample` |
| T-024 | ROS 2 map fixture | Occupancy ingest | OccupancyGrid-style payload converts to `MapDelta` |
| T-025 | Detection fixture | Immutable event | HTTP detection creates immutable raw event |
| T-026 | AI no direct execution | AI boundary | AI proposal alone does not change drone assignment/target |
| T-027 | Rejected proposal | AI boundary | Rejected proposal cannot be approved |
| T-028 | Prompt injection | AI boundary | User text/tool result cannot call command API |
| T-029 | UI smoke: load/start | Operator workflow | App loads, scenario starts, state updates |
| T-030 | UI smoke: detection | Operator workflow | Detection review changes review state |
| T-031 | UI smoke: proposal | Operator workflow | Proposal approve/reject path works |
| T-032 | UI smoke: replay/export | Evidence workflow | Export downloads manifest and replay seek works |

## Manual Acceptance Scenario

1. Start `rubble-training` with seed `4242`.
2. Confirm three drones receive explicit zones.
3. Confirm coverage grows deterministically.
4. Trigger link loss or scripted dropout on one drone.
5. Confirm its assigned zone becomes incomplete and eligible for reassignment.
6. Generate AI proposal.
7. Confirm proposal diff explains the reassignment.
8. Approve reassignment through command pipeline.
9. Trigger seeded detection.
10. Confirm immutable detection, alert, evidence detail, and review workflow.
11. Export mission package.
12. Replay mission package.
13. Confirm replay final state hash matches original final state hash.

## Release Gate Before Real Command Upload

Real command upload is blocked until:

- T-001 through T-028 pass.
- Safety case covers the command class.
- FAA/regulatory matrix is reviewed for the test venue.
- Operator has an independent emergency stop/RC/failsafe path.
- MAVLink/ROS read-only ingest has been exercised with fixture and, later, bench hardware.
