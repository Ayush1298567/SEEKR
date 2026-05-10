# SEEKR Hazard Log

Created: 2026-05-04

| ID | Hazard | Detection | Mitigation | Verification | Owner | Residual Risk |
|---|---|---|---|---|---|---|
| H-001 | Lost GCS link | Link quality/stale heartbeat | PX4 data-link failsafe; scenario policy continue/hold/RTH/land | Link-loss sim/manual test | Safety | Medium |
| H-002 | Low battery | Battery telemetry/reserve validator | Dynamic reserve; return/hold; FC battery failsafe | Low-battery sim/manual test | Safety | Medium |
| H-003 | Estimator failure | Estimator quality telemetry | Block movement commands; hold/return policy; FC position-loss failsafe | Estimator-degradation test | Robotics | Medium |
| H-004 | Companion crash | Missing companion heartbeat | FC failsafe, independent RC/emergency path | Bench fault injection | Robotics | Medium |
| H-005 | GCS failure | WebSocket disconnect/operator loss | FC failsafe; no GCS as sole safety authority | GCS-kill manual test | Safety | Medium |
| H-006 | Geofence/no-fly breach | Local bounds/no-fly validator; FC geofence | Reject commands; FC geofence action | Validator and FC config review | Safety | Medium |
| H-007 | Drone collision | Proximity/clustering validator | One investigator default; separation rules; onboard avoidance V2 | Clustering validator test | Robotics | Medium |
| H-008 | Emergency stop unavailable | Preflight checklist | Independent RC/FC emergency action required before real flight | Preflight procedure | Ops | Medium |
| H-009 | AI unsafe command | Command lifecycle audit | AI drafts only; deterministic validators; operator approval | AI boundary tests | Software | Low |
| H-010 | Map conflict hides obstacle | Conflict cell flag | Flag conflicts, avoid high-risk cells, operator warning | Map fusion conflict test | Robotics | Medium |
| H-011 | Stale map used as current | Last-seen timestamp/stale flag | Stale layer and validator warnings | Stale-source test | Software | Low |
| H-012 | Detection false positive | Human review workflow | No auto-retask; evidence detail; review event | Detection review test | Product | Medium |
| H-013 | Sensitive evidence leak | Evidence inventory/export review | Least retention, redaction metadata, hash references | Privacy/security review | Security | Medium |
