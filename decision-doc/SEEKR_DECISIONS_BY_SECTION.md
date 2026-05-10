# SEEKR Decisions By Section

Created: 2026-05-04  
Format: one decision, why, implementation path, acceptance criteria, source pointer, and pushback/open risk per subsection.

## Source Codes

- **PX4:** https://docs.px4.io/main/en/sim_gazebo_gz/ and https://docs.px4.io/main/en/config/safety.html
- **MAVLink:** https://mavlink.io/en/messages/common.html
- **ROS:** https://docs.ros.org/en/jazzy/Releases/Release-Jazzy-Jalisco.html and https://docs.ros.org/en/jazzy/p/nav_msgs/index.html
- **MCAP:** https://mcap.dev/spec
- **ModalAI:** https://docs.modalai.com/starling-2-datasheet/ and https://docs.modalai.com/voxl-2/
- **Livox:** https://www.livoxtech.com/de/mid-360/specs
- **FAA:** https://www.faa.gov/newsroom/small-unmanned-aircraft-systems-uas-regulations-part-107, https://www.faa.gov/uas/getting_started/remote_id, https://www.faa.gov/newsroom/beyond-visual-line-sight-bvlos
- **Security:** https://csrc.nist.gov/pubs/sp/800/218/final, https://www.cisa.gov/sbom, https://www.nist.gov/privacy-framework

## 1. Flight And Hardware

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 1.1 Frame material | V1 carbon fiber via integrated platform; V2 hybrid carbon/replaceable guards. | V1 should prioritize proven stiffness/weight; SAR product needs repairability. | Track mass and repair BOM; test partial guards. | Frame budget includes mounts, guards, fasteners. | ModalAI | Carbon-only product may be brittle in field impacts. |
| 1.2 Frame size | Split V1 sub-350 g VIO and V2 450-900 g+ payload class. | LiDAR/thermal/redundant radio stack does not fit the original target. | Maintain two aircraft requirement tables. | Each concept has mass/power/endurance margin. | ModalAI, Livox | A single all-in small aircraft target is rejected. |
| 1.3 Battery chemistry | Li-Ion for endurance; LiPo for lab agility only. | Search rewards coverage duration more than thrust bursts. | Record pack mass, discharge curve, reserve policy. | 25 min field target for V2; lab demo can be shorter. | ModalAI | Li-Ion voltage sag must be validated under payload load. |
| 1.4 Flight controller | PX4/Pixhawk/VOXL2 class, no custom FC. | Existing flight stacks own stabilization, logs, and failsafes. | MAVLink/PX4 contracts; ArduPilot comparison only. | FC failsafes remain authoritative. | PX4, MAVLink | Custom FC would create avoidable safety burden. |
| 1.5 Motor/prop | Integrated V1 stack; endurance-optimized V2 stack. | SAR needs efficient search, not racing performance. | Test prop guards and payload effects. | Flight time measured with final payload. | ModalAI | Aggressive props reduce endurance and VIO stability. |
| 1.6 Prop guards | Partial/TPU guards first; ducts only for indoor specialty craft. | Full ducts cost endurance; no guards is unsafe near people/debris. | Compare unguarded, partial, and ducted configurations. | Guard choice documented with flight-time loss. | ModalAI | Field/customer environment may force heavier protection. |
| 1.7 Flight time | 25 min field minimum; 15 min lab acceptable. | Coverage and recovery need reserve. | Dynamic reserve in validators and simulator. | Low battery triggers return/hold policy. | PX4 | Payload growth can break target. |
| 1.8 6-inch under 350 g flag | Rewrite target into V1 VIO and V2 payload classes. | Livox-class LiDAR alone consumes most of the original mass budget. | Maintain explicit hardware assumptions in docs. | No plan claims LiDAR+Jetson+thermal under 350 g. | Livox, ModalAI, NVIDIA | Physics/SWaP pushback is final until measured otherwise. |

## 2. Onboard SLAM

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 2.1 Primary sensor | VIO first; LiDAR V2. | VIO matches sub-350 g; LiDAR changes aircraft class. | Use ROS-style pose/map fixtures and later VOXL logs. | Estimator quality visible and validated. | ModalAI, ROS | VIO degrades in darkness/smoke/low texture. |
| 2.2 LiDAR model | No V1 LiDAR; evaluate Mid-360 on V2 rig. | Mid-360 weight/power exceed V1 SWaP. | Bench/dev-rig only until aircraft class grows. | LiDAR test has mass/power/thermal budget. | Livox | 2D LiDAR is lighter but weak for 3D SAR. |
| 2.3 SLAM algorithm | OpenVINS/VOXL VIO baseline; FAST-LIO2/KISS-ICP/LIO-SAM later. | Flight estimator first, mapping quality second. | Log replay benchmarks. | Drift/failure metrics per scenario. | ModalAI, research/SOURCES.md | Algorithm choice before logs is premature. |
| 2.4 Map representation | V1 2D/2.5D occupancy; V2 OctoMap/3D. | Local GCS needs reliable coverage/conflicts first. | `MapDelta` with confidence/source/freshness. | Unknown/free/occupied/frontier preserved. | ROS, MCAP | 3D map claims need real LiDAR. |
| 2.5 Dynamic objects | Tag/filter dynamic detections, do not bake into static map. | People/drones should not become permanent obstacles. | Separate `DetectionEvent` and map cells. | Dynamic objects never permanently occupy cells. | ROS | Dynamic SLAM is V2 research. |
| 2.6 Compute target | VOXL2-class for V1; Jetson bench/heavier V2. | VOXL integrates flight/autonomy; Jetson adds SWaP. | Keep compute adapter boundaries. | Hardware decision includes power/thermal. | ModalAI, NVIDIA | Jetson may be overkill for V1 aircraft. |
| 2.7 FAST-LIO2 vs LIO-SAM | FAST-LIO2 onboard if LiDAR; LIO-SAM/KISS-ICP for benchmarks. | Different algorithms optimize for different constraints. | Evaluate on recorded logs. | Benchmark report before aircraft integration. | research/SOURCES.md | No log, no serious algorithm decision. |

## 3. Onboard Detection

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 3.1 Modality | RGB/sim fixture V1; RGB+thermal V2. | Fastest baseline first; field/night needs thermal later. | Immutable detection ingest and evidence references. | Detections are advisory, reviewable, and replayable. | research/SOURCES.md | RGB-only is not field-complete. |
| 3.2 Thermal camera | Boson-class serious V2; Lepton prototype only. | Resolution and sensitivity matter for SAR. | Keep thermal optional in schema. | Thermal payload has SWaP and evidence tests. | research/SOURCES.md | Thermal cost and export constraints may matter. |
| 3.3 Model architecture | Small detector baseline; measure false positives separately. | SAR misses and false alarms have different operational costs. | Dataset ledger and benchmark harness. | Precision/recall reported by environment. | research/SOURCES.md | Model cards cannot replace field data. |
| 3.4 Training data | Public SAR/aerial datasets plus internal opt-in data. | Domain shift is high. | No customer evidence training without written opt-in. | Dataset provenance documented. | Security, research/SOURCES.md | Synthetic data can overfit. |
| 3.5 False positives | Detections create alerts and review tasks, not commands. | False positives can waste battery and create unsafe clustering. | Review events separate from raw detections. | False-positive review preserves raw event. | MCAP | Do not auto-retask on detector output. |
| 3.6 Acoustic | Research add-on only. | Prop noise and environment make it hard. | Leave schema extensible. | No V1 requirement depends on acoustic. | research/SOURCES.md | Acoustic claims likely overpromise. |
| 3.7 Segmentation/prop noise | Segment evidence if useful; prop-noise mitigation not V1-critical. | First need reliable detection/evidence workflow. | Optional model metadata. | Evidence UI works before model expansion. | research/SOURCES.md | Fine model work should not block platform. |

## 4. Onboard Autonomy

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 4.1 Exploration | Explicit zones and frontier allocation first. | Deterministic, inspectable, and testable. | Scenario zones and task ledger. | Three drones cover assigned zones in sim. | ROS | Curiosity-only exploration is hard to certify. |
| 4.2 Path planner | Simple local planner in sim; PX4/onboard planner later. | Web app is not flight-critical planner. | GCS proposes targets; FC owns safety. | Commands validate geofence/battery/estimator/link. | PX4 | GCS path plans must not bypass FC. |
| 4.3 Avoidance | Sim obstacles V1; onboard avoidance later. | Real avoidance depends on sensors/FC. | Occupancy cells and no-fly zones. | Blocked cells avoided in sim planner. | PX4, ROS | V1 sim does not prove field avoidance. |
| 4.4 Behavior architecture | Event/command state machine, not free-form AI. | Auditable behavior beats opaque autonomy. | Command lifecycle and reducers. | Every action has lifecycle/audit evidence. | MCAP | Behavior trees can come after core state. |
| 4.5 Curiosity | Define as frontier value within zone and policy limits. | Avoids vague exploration behavior. | Frontier score with zone priority/coverage. | Allocator result explainable. | ROS | Curiosity cannot override safety policy. |
| 4.6 Link loss | Continue/RTH/land policy per mission; V1 sim configurable. | SAR may need short autonomous continuation, but safety dominates. | Scripted link-loss faults. | Link loss follows configured behavior. | PX4 | Real policy depends on venue and waiver. |
| 4.7 Policy notes | Advisory/semi-auto only. | Operator trust and liability require approval. | Trust mode and validators. | Full-auto limited to simulator/training. | FAA, PX4 | Marketing must not imply autonomous deployment. |

## 5. Drone-Side Comms

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 5.1 Primary radio | Separate telemetry/C2 from video. | Video loss should not imply state loss. | Link-quality telemetry and store-forward events. | UI flags degraded/stale link. | MAVLink | Real RF performance needs field tests. |
| 5.2 Drone mesh | V2; GCS-centralized V1. | Mesh adds complexity without V1 hardware. | Central task allocator first. | No V1 feature depends on drone-to-drone mesh. | research/SOURCES.md | Mesh may be needed in rubble. |
| 5.3 Position/ranging | No UWB in V1; optional V2 aid. | Adds hardware, calibration, and deployment burden. | Adapter schema can include ranging later. | V1 runs without UWB. | research/SOURCES.md | GPS-denied indoor may need extra aids. |
| 5.4 Protocol stack | MAVLink/PX4 for vehicle; ROS 2 map/detection fixtures. | Primary ecosystems align with flight and robotics. | Normalizers and Zod schemas. | Fixtures map into canonical state. | MAVLink, ROS | DDS/network config can be brittle. |
| 5.5 Sync payload | Telemetry, map deltas, detections, evidence references. | Raw video is too heavy for always-on sync. | Hash/path evidence references. | Export contains evidence index. | MCAP | Evidence retention policy must be explicit. |
| 5.6 Offline duration | Short bounded continuation only. | Long offline autonomy raises safety/regulatory risk. | Mission policy and failsafe matrix. | Offline drone state degrades and alerts. | PX4, FAA | SAR desire for persistence conflicts with safety. |
| 5.7 Comms notes | Measure before claiming range. | Environments vary. | RF test plan. | Logs include link/stale telemetry. | MAVLink | Vendor specs are not field guarantees. |

## 6. Global Map Fusion

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 6.1 Fusion approach | Conservative V1 occupancy fusion. | Full multi-SLAM is V2. | Confidence-weighted/log-odds-style deltas. | Conflicts flagged. | ROS | Overconfident fusion is dangerous. |
| 6.2 Alignment | Source frame and transform confidence required. | Bad transforms corrupt maps. | Reject low-confidence/stale transforms. | Every delta stores frame/transform confidence. | ROS | Real frame transforms need calibration. |
| 6.3 Data structure | 2D grid cells V1; 3D later. | UI and tests need simplicity. | `MapCell` and `MapDelta`. | Unknown/free/occupied/frontier states preserved. | ROS | 2D underrepresents vertical hazards. |
| 6.4 Conflicts | Flag, do not overwrite silently. | Operators need uncertainty. | Conflict metadata on cells and alerts if severe. | Contradictory deltas create conflict markers. | ROS | Too many conflicts can overwhelm UI. |
| 6.5 Compute | Local GCS V1. | Local-first and no cloud dependency. | Single-process TypeScript core. | Works offline. | MCAP | Large maps may need native acceleration. |
| 6.6 Latency | UI target under 1 s for sim state. | Operators need timely awareness. | WebSocket envelopes and state seq. | Monotonic seq visible. | MCAP | Real radio latency may exceed target. |
| 6.7 Simpler V1 | Yes: map indexing, not true fusion. | Faster useful demo. | Coverage/source/conflict layers. | V1 scenario complete in sim. | ROS | Do not label as solved SLAM fusion. |

## 7. GCS AI / LLM Layer

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 7.1 Role | Explain, query, estimate, draft only. | LLMs should not own authority. | Tool registry and proposals. | No direct state mutation by AI. | Security | Prompt injection risk remains. |
| 7.2 Model | Provider-agnostic local/cloud optional. | Deterministic core must work without model. | Store provider/model metadata. | System runs with AI disabled. | Security | Model changes can alter proposals. |
| 7.3 Framework | MCP-style facade over internal tools later. | Avoid coupling product to one agent runtime. | Canonical tool registry first. | `/api/tools` exposes safe tools. | Security | Tool schema drift needs tests. |
| 7.4 Tools | Read tools plus draft command tools. | Clear authority boundary. | Add `*_draft` tools. | Command drafts require validators/approval. | Security | Command-capable tools must be blocked. |
| 7.5 Trust | Advisory/semi-auto/training-auto. | Simulator can train, real ops need approval. | Trust mode in state. | Full-auto unavailable for real adapter. | FAA | User pressure for full auto must be resisted. |
| 7.6 Guardrails | Deterministic validators first. | Safety logic must be testable. | Validator matrix. | Rejected/stale proposals cannot execute. | PX4, Security | Guardrails need ongoing review. |
| 7.7 Essential? | No. | V1 must function without AI. | AI optional service. | Manual mission scenario works. | Security | AI should not mask missing UX. |

## 8. Operator UI

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 8.1 Platform | Web local GCS. | Current scaffold and local-first use. | React/Vite/Express. | Runs on localhost. | Existing repo | Browser app is not flight-critical. |
| 8.2 Map | Grid/testbed V1; real map library later. | Deterministic tests first. | Map layers in React. | Occupancy/frontier/conflict/stale visible. | ROS | Real geospatial maps need CRS work. |
| 8.3 Video | On-demand evidence, not primary UI. | Bandwidth and attention. | Evidence asset model. | Detection card shows evidence references. | MCAP | Operators may still need live video. |
| 8.4 Layout | Map-centric dashboard. | Coverage/status/detections dominate. | Top metrics, map, alert/evidence rail. | No video wall. | Existing repo | UI must be tested with responders. |
| 8.5 Actions | Commands through review/approval pipeline. | Audit and safety. | `POST /api/commands`. | Every UI action creates lifecycle events. | MCAP | Extra steps can slow operators. |
| 8.6 Alerts | Severity, review, ack, stale/degraded states. | SAR attention management. | Alert feed and detection workflow. | P1 open count correct. | Existing repo | Alert fatigue is a risk. |
| 8.7 Hardware notes | Laptop/tablet local station first. | Field ruggedization later. | Responsive but dense dashboard. | Works at target viewport. | Existing repo | Sunlight/gloves/rain need later tests. |

## 9. Swarm Coordination

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 9.1 Paradigm | Centralized GCS allocation V1. | Easier audit and operator approval. | Task ledger and zone assignments. | Three drones complete explicit zones. | ROS | GCS failure is single-point risk. |
| 9.2 Assignment | Explicit zones then frontiers. | Measurable coverage. | Frontier allocator. | Reassignment proposal after dropout. | ROS | Complex terrain may need better planner. |
| 9.3 Cluster on detection | One investigator by default. | Avoid congestion and wasted battery. | Validator blocks excessive clustering. | More drones require approval. | PX4 | Critical incidents may need multiple drones. |
| 9.4 Failure recovery | Mark task incomplete and propose reassignment. | Keeps coverage honest. | Drone dropout event updates zone/task. | Zone eligible for reassignment. | MCAP | Real lost drone location uncertainty. |
| 9.5 Drone add | V2. | Dynamic fleet add increases complexity. | Adapter contracts support later. | V1 fixed scenario drones. | MAVLink | Real operations may need replacement drones. |
| 9.6 Frequency | State deltas at 1 Hz V1, configurable later. | Good enough for sim/operator UI. | WebSocket envelopes. | Monotonic seq and reconnect. | MCAP | High-speed flight needs faster loops onboard. |
| 9.7 Notes | Swarm is workflow first, autonomy second. | Prevents premature distributed AI. | Ledger/export evidence. | Task history exportable. | Security | Do not oversell swarm intelligence. |

## 10. Comms Architecture

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 10.1 Topology | GCS hub V1. | Local-first and auditable. | Single local server. | No cloud required. | Existing repo | Terrain may require relays. |
| 10.2 Redundancy | Design for V2, simulate V1. | Hardware not available. | Link quality/stale flags. | Fault scenarios include link loss. | MAVLink | Actual redundancy adds RF/cost burden. |
| 10.3 Antenna | Ground station measurement later. | RF is site-specific. | Field test plan. | Logs capture RSSI/link quality where available. | MAVLink | Specs do not guarantee rubble range. |
| 10.4 Bandwidth | Prioritize telemetry/map/detections over video. | Mission safety/state comes first. | Evidence-on-demand. | Video not required for core sim. | MCAP | Some evidence workflows need clips. |
| 10.5 Notes | Store-and-forward and stale indicators. | Lossy links are expected. | Adapter metadata and timestamps. | Stale source visible on map. | MAVLink | Clock sync matters. |

## 11. Safety And Failsafes

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 11.1 Lost comms | Configured continue/RTH/land; FC authoritative. | PX4 failsafes already exist. | Failsafe matrix and simulator faults. | Link loss follows policy. | PX4 | Indoor GPS-denied RTH may be unsafe. |
| 11.2 Battery reserve | Dynamic reserve with return/hold policy. | Avoids unrecoverable aircraft. | Validator and sim threshold. | Low battery event triggers action/alert. | PX4 | Reserve depends on wind/payload. |
| 11.3 Collision | V1 separation policy; onboard avoidance V2. | No real sensors in V1. | Cluster validators and task spacing. | Excess clustering blocked. | PX4 | True collision avoidance requires hardware. |
| 11.4 Geofence | Local mission bounds/no-fly zones. | GPS-denied still needs spatial constraints. | Map-bound validator and no-fly zones. | Out-of-bounds command rejected. | PX4 | Local frame drift can violate real bounds. |
| 11.5 Emergency stop | Real FC/RC safety switch later; UI event now. | UI cannot be sole emergency stop. | Safety docs and command class gate. | Real command authority blocked until covered. | PX4 | Human factors need field testing. |
| 11.6 Coverage | Hazard log/FMEA/STPA required. | Safety case must precede ops. | Safety docs. | Critical hazards have detection/mitigation/test. | PX4, FAA | Unknown unknowns remain. |
| 11.7 Notes | No "autonomy works normally" assumptions. | Failure mode must be explicit. | Fault scenarios. | Manual acceptance covers faults. | Security | Safety case must stay living. |

## 12. Regulatory / FAA

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 12.1 Deployment | Part 107/VLOS/training first. | Active, understood baseline. | FAA matrix and CONOPS. | Claims mapped to operating authority. | FAA | Public-safety COA/waiver varies by agency. |
| 12.2 Domain | Controlled training site first. | Lower risk and repeatable tests. | V1 CONOPS. | No routine BVLOS claim. | FAA | Real SAR urgency changes risk. |
| 12.3 Remote ID | Required where applicable. | FAA Remote ID is active. | Aircraft inventory includes RID status. | Compliance documented before flights. | FAA | Sub-250/research exceptions can confuse claims. |
| 12.4 Insurance/liability | Obtain aviation/legal review before pilots. | SAR autonomy has high liability. | Risk register owner. | Lawyer review before BVLOS claims. | FAA | Insurance may restrict autonomy. |
| 12.5 Notes | Part 108 readiness only. | BVLOS proposed path is not an operating permission by itself. | Re-verify at implementation time. | Docs include dated regulatory status. | FAA | Rules may change. |

## 13. Scalability

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 13.1 BOM | V1 dev cost accepted; product BOM later. | Prototype speed beats premature BOM optimization. | BOM workbook later. | Every aircraft concept has BOM/mass/power. | ModalAI | Professional SAR product will be expensive. |
| 13.2 Manufacturing | Integrated platform first; custom later. | Reduces early integration risk. | Manufacturing readiness doc. | Supplier/QA risks listed. | ModalAI | Supply chain constraints. |
| 13.3 Pricing | Hardware + software + training/support bundle. | Public safety buys capability and support. | GTM/pricing doc. | Pricing tied to pilot scope. | research/SOURCES.md | Procurement cycles are slow. |
| 13.4 Fleet | Local fleet inventory and maintenance states. | Safety and ops need traceability. | Fleet ops manual and schema. | Drone version/hours/check state tracked. | Security | Fleet ops can outgrow local-only. |
| 13.5 OTA | Signed staged rollout, no blind auto-update. | Updates can ground or endanger aircraft. | OTA policy. | Rollout: 1 unit, small batch, full fleet, rollback. | Security | Key management burden. |

## 14-20 Business, Ops, Data, Workflow

| Section | Decision | Why | Implementation Path | Acceptance Criteria | Sources | Open Risk / Pushback |
|---|---|---|---|---|---|---|
| 14 Target customer | Design partners in SAR/fire/US&R training, not broad FEMA-first sale. | Need field feedback and controlled pilots. | Interview and pilot package. | 3-5 design partner reviews. | FAA, research/SOURCES.md | Procurement/authority complexity. |
| 15 Pricing model | Pilot bundle then annual support/software. | Hardware-only margins miss support burden. | GTM/pricing doc. | Pilot price covers training/support. | research/SOURCES.md | Price must match agency budgets. |
| 16 Competitive positioning | GPS-denied SAR evidence workflow and simulator/replay, not generic drone. | Differentiation is safety/evidence/coverage. | Competitive matrix. | Claims are evidence-backed. | research/SOURCES.md | Larger vendors can copy UI features. |
| 17 Roadmap | Sim -> single VIO -> 3-drone controlled -> read-only ingest -> guarded commands. | Reduces safety/regulatory risk. | Build backlog. | No step skipped. | PX4, FAA | Hardware pressure may push premature flight. |
| 18 Funding | Seed with credible demo, safety case, and design partners. | Deeptech needs evidence. | Pilot package. | Demo plus docs plus logs. | research/SOURCES.md | Capital needs grow with hardware. |
| 19 Data/privacy | Least retention, no facial recognition V1, no evidence training without opt-in. | Public-safety data is sensitive. | Privacy/security doc and evidence policy. | Export includes retention/redaction metadata. | Security | State/local data rules vary. |
| 20 Workflow | Test-driven local platform and living docs. | Safety cases rot without process. | CI tests, docs, audit logs. | Tests pass before real command class. | Security, MCAP | Process overhead can slow prototype. |
