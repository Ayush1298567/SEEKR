# SEEKR Risk Register

Created: 2026-05-04  
Status: living risk register for V1 simulator/GCS/replay and V2 hardware integration.

| ID | Risk | Area | Severity | Likelihood | Detection | Mitigation | Verification | Owner | Residual Risk |
|---|---|---:|---:|---:|---|---|---|---|---|
| R-001 | Original aircraft target exceeds SWaP budget | Hardware | High | High | Mass/power budget | Split V1 VIO and V2 payload aircraft | BOM/mass review | Systems | Medium |
| R-002 | VIO fails in low texture/dark/smoke | Localization | High | Medium | Estimator quality telemetry, replay logs | V1 controlled environments; V2 thermal/LiDAR research | VIO failure scenarios | Robotics | Medium |
| R-003 | GCS state cannot be reconstructed after incident | Software | High | Medium | Replay mismatch | Event-sourced hash-chained log | Replay reconstruction tests | Software | Low |
| R-004 | Simulator is nondeterministic | Software | Medium | Medium | Byte-stability tests | Seeded RNG and simulator clock | Determinism tests | Software | Low |
| R-005 | AI proposal bypasses validator | AI/Safety | High | Medium | Command lifecycle audit | AI can only create drafts; approval creates normal command | AI boundary tests | Software | Low |
| R-006 | Stale AI proposal is approved | AI/Safety | Medium | Medium | Proposal age check | Validator blocks stale approvals | Validator tests | Software | Low |
| R-007 | Command sent to offline/failed drone | Safety | High | Medium | Drone health validator | Block offline/failed targets | Command tests | Software | Low |
| R-008 | Low battery drone gets retasked away from home | Safety | High | Medium | Battery reserve validator | Dynamic reserve and return policy | Low battery tests | Safety | Medium |
| R-009 | Link loss policy is unsafe indoors | Safety | High | Medium | Link loss simulation | Per-site lost-link policy; FC failsafes | Manual fault scenario | Safety | Medium |
| R-010 | Bad map transform corrupts global map | Mapping | High | Medium | Transform confidence check | Reject low-confidence/stale deltas; flag conflicts | Map fusion tests | Robotics | Medium |
| R-011 | People/drones become permanent obstacles | Mapping | Medium | Medium | Semantic/detection separation | Keep dynamic detections separate from occupancy | Map tests | Robotics | Low |
| R-012 | Detection false positive causes unsafe swarm clustering | Perception | Medium | High | Review workflow, clustering validator | One investigator by default; operator approval for more | AI/validator tests | Software | Medium |
| R-013 | Detection false negative misses survivor | Perception | High | Medium | Dataset benchmark | Treat model as advisory; coverage workflow remains primary | Detection benchmark | Perception | Medium |
| R-014 | Video consumes bandwidth needed for telemetry | Comms | Medium | Medium | Link metrics | On-demand video/evidence; telemetry priority | Field RF tests | Comms | Medium |
| R-015 | Operator misses P1 alert | UX | High | Medium | Alert open count/timing | Severity feed, evidence detail, audit | UI smoke/manual test | Product | Medium |
| R-016 | Replay export contains sensitive raw evidence | Privacy | High | Medium | Evidence inventory | Least retention, redaction state, evidence hashes | Privacy review | Security | Medium |
| R-017 | Customer evidence used for training without consent | Privacy | High | Low | Data provenance audit | Written opt-in only | Policy review | Security | Low |
| R-018 | Dependency vulnerability affects field laptop | Security | Medium | Medium | Dependency scanning/SBOM | SSDF, SBOM, patch process | Security checks | Security | Medium |
| R-019 | Unsigned OTA update compromises fleet | Security/Fleet | High | Medium | Signature verification | Signed releases and staged rollout | OTA test | Security | Low |
| R-020 | Blind auto-update grounds aircraft during mission | Fleet | High | Medium | Fleet version state | No blind auto-update; operator-approved staged rollout | OTA policy test | Ops | Low |
| R-021 | FAA/BVLOS claims outpace permission | Regulatory | High | Medium | Regulatory review | Part 107/VLOS first; legal review gate | FAA matrix review | Ops | Medium |
| R-022 | Remote ID gap blocks operations | Regulatory | High | Medium | Fleet RID inventory | RID compliance before applicable flights | Preflight checklist | Ops | Low |
| R-023 | Real command upload enabled before safety case | Safety | High | Low | Feature gate | Block command class until docs/tests pass | Release checklist | Safety | Low |
| R-024 | GCS is treated as flight-critical without certification | Safety | High | Medium | CONOPS review | FC remains authoritative; GCS advisory/mission layer | Safety case review | Safety | Medium |
| R-025 | Public-safety procurement too slow | Business | Medium | High | Pipeline review | Design partners and training pilots | GTM review | Business | Medium |

## Immediate Top Risks

1. **R-001 SWaP overreach:** closed by keeping V1 no-LiDAR and integrated VIO-first.
2. **R-003/R-004 evidence quality:** closed by event sourcing, deterministic simulator, and replay tests.
3. **R-005 AI boundary:** closed by command lifecycle and validators.
4. **R-021 regulatory overclaim:** closed by dated FAA matrix and legal review before BVLOS claims.
