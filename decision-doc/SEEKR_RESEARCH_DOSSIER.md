# SEEKR Research Dossier

Created: 2026-05-04  
Purpose: source-backed technical basis for SEEKR V1/V2 decisions.

## Research Stance

SEEKR should be treated as a safety-critical robotics system even during simulation. The system must make conservative claims, gather evidence before expanding autonomy, and keep deterministic software in charge of command authority. The LLM layer is a user-interface aid and research assistant, not a flight control component.

## Workstream 1 - Drone Edge

### Hardware And SWaP

**Decision:** split aircraft concepts into V1 VIO-first sub-350 g only if integrated hardware is used, and V2 450-900 g+ for LiDAR/thermal/redundant communications.

**Why:** ModalAI's Starling 2 datasheet lists a 285 g takeoff weight, VOXL2 autopilot, VIO sensor configuration, 230 mm diagonal, 120 mm props, carbon frame, and >35 minute flight time. That supports a credible VIO prototype class. Livox Mid-360 alone is listed at 265 g and 6.5 W, which makes the original under-350 g LiDAR/Jetson/thermal/UWB stack physically implausible once battery, frame, motors, mounts, compute, cables, and guards are included.

**Implementation path:** V1 software must remain hardware-agnostic while keeping adapter contracts aligned with PX4/MAVLink and ROS 2. Hardware work starts with logs/fixtures, then one integrated VIO aircraft, then controlled three-drone testing.

**Acceptance:** every hardware concept includes mass, power, endurance, payload, thermal, comms, and safety margin budgets.

**Sources:** ModalAI Starling 2 datasheet, ModalAI VOXL 2 docs, Livox Mid-360 specs, NVIDIA Jetson Orin Nano docs.

### Flight Stack

**Decision:** PX4/MAVLink is the default contract. ArduPilot remains a comparison path. No custom flight controller for V1.

**Why:** PX4 provides SITL, Gazebo integration, MAVLink streams, and documented failsafe behavior. Rebuilding stabilization, estimator integration, and failsafes would create avoidable safety and schedule risk.

**Implementation path:** V1 implements a simulator and read-only MAVLink normalizer. Real command upload starts with hold/RTH only after replay, validators, and safety case coverage pass.

**Acceptance:** MAVLink fixture messages normalize into `TelemetrySample` and mission state without enabling command authority.

**Sources:** PX4 Gazebo/SITL docs, PX4 safety/failsafe docs, MAVLink common message set.

### Localization And SLAM

**Decision:** V1 uses VIO/local odometry concepts and conservative GCS map indexing. V2 can evaluate FAST-LIO2/KISS-ICP/LIO-SAM/Kimera-Multi-style fusion after real LiDAR logs exist.

**Why:** GPS-denied SAR depends on estimator quality. True multi-robot SLAM fusion is a research problem and should not block V1 operator workflow. ROS 2 `nav_msgs` gives a practical vocabulary for occupancy grid, odometry, and path contracts without choosing the final SLAM stack too early.

**Implementation path:** normalize map deltas into a source/confidence/freshness-aware 2D occupancy layer first. Preserve source frame, transform confidence, stale-source flags, and conflicts. Do not silently overwrite contradictory maps.

**Acceptance:** map fusion rejects malformed/oversized/stale deltas, flags conflicts, and treats detections/people/drones separately from permanent obstacles.

**Sources:** ROS 2 Jazzy `nav_msgs`, OpenVINS, FAST-LIO2, LIO-SAM, ORB-SLAM3, OctoMap, Kimera-Multi/COVINS/Swarm-SLAM references in `research/SOURCES.md`.

### Detection

**Decision:** V1 detection is advisory RGB or simulated fixture data. V2 adds thermal when aircraft SWaP and evidence workflow can support it.

**Why:** Detection false positives/false negatives can create unsafe retasking. Detections should create immutable events and review tasks, not direct commands.

**Implementation path:** store immutable detection events, link evidence assets by hash/path, keep reviews as separate events, and show detection detail in the GCS.

**Acceptance:** every detection can be traced to source adapter, frame/evidence reference, confidence, review status, and audit events.

## Workstream 2 - GCS

### Event-Sourced Mission Engine

**Decision:** mission state is a read model rebuilt from append-only `MissionEvent` records.

**Why:** SAR workflows need replayability, evidence packaging, audit trails, and deterministic tests. Direct mutation cannot prove what happened after the fact.

**Implementation path:** simulator ticks, operator commands, AI proposal approvals, adapter ingest, reviews, and exports all become typed events. Event hashes chain across the mission.

**Acceptance:** replay from events reconstructs the same final state and detects tampered event logs.

### Simulator

**Decision:** build a deterministic simulator before hardware.

**Why:** No hardware is available, and simulation allows battery, link, estimator, dropout, stale-map, false-positive, and duplicate-detection failure cases to be tested repeatedly.

**Implementation path:** seeded RNG, simulator clock independent from wall time, scenario definitions with scripted faults and expected outcomes, and replay export.

**Acceptance:** same scenario and seed produce byte-stable simulator events and final state.

### AI Boundary

**Decision:** AI uses MCP-style tools but never mutates mission state directly.

**Why:** LLM output is not deterministic enough for flight authority. It can summarize, explain, estimate, and draft commands, but validators and operator approval own execution.

**Implementation path:** tool registry exposes read tools and draft-producing tools. Approval creates normal command requests.

**Acceptance:** rejected proposals cannot be approved, stale proposals fail validation, and prompt-injection text cannot call command APIs.

### Operator UI

**Decision:** map-centric UI with coverage, detections, stale sources, conflicts, zones, health, command review, replay, and evidence export. Video is on-demand.

**Why:** SAR operators need coverage, confidence, and alerts more than a wall of video feeds. Video bandwidth also competes with telemetry and map data.

**Implementation path:** map layers, right-side alert/evidence rail, command review modal, replay timeline, export control, and degraded-comms indicators.

**Acceptance:** operator can start scenario, observe deterministic coverage, review detection evidence, approve/reject AI proposal, seek replay, and export bundle.

## Workstream 3 - System, Safety, Regulatory, Ops

### Comms And Failsafes

**Decision:** separate command/telemetry from payload/video traffic, and keep flight-controller failsafes authoritative.

**Why:** PX4 failsafe documentation covers battery, geofence, position loss, RC/data link loss, and termination/land/return behavior. The GCS cannot be the final safety authority.

**Implementation path:** state tracks link quality, estimator quality, stale telemetry, battery reserve, command authority, and emergency state. Safety docs map hazards to detection/mitigation/tests.

**Acceptance:** lost comms, low battery, estimator failure, companion crash, GCS failure, geofence breach, collision risk, and emergency stop are represented in hazard/failsafe matrices.

### Regulatory

**Decision:** US-first Part 107/VLOS/training path. Remote ID compliance is required where applicable. BVLOS/Part 108 is readiness work only until verified final and operational.

**Why:** FAA Remote ID and Part 107 are active compliance baselines. FAA BVLOS material describes a proposed path and requirements, but SEEKR should not market routine BVLOS as solved.

**Implementation path:** maintain FAA matrix, CONOPS, waiver/COA notes, public-safety partnership path, and lawyer-review gate.

**Acceptance:** marketing, demos, and pilot plans distinguish VLOS/Part 107/COA/waiver/future Part 108 assumptions with dates and evidence.

### Security And Privacy

**Decision:** least-data retention, no facial recognition in V1, no training on customer evidence without written opt-in, append-only audit, hash-chained exports, signed updates, SBOM, and staged OTA.

**Why:** Public-safety drone data can include sensitive location, identity, medical, and operational details. Even when not formally CJI, it should be treated as CJIS-adjacent.

**Implementation path:** retention policy per evidence asset, redaction state, local-first operation, signed releases, SBOM generation, dependency scanning, and staged rollout with rollback.

**Acceptance:** every mission export has hashes, retention/redaction metadata, software/schema version, and audit trail.

**Sources:** NIST SSDF SP 800-218, CISA SBOM guidance, NIST Privacy Framework, FBI CJIS Security Policy reference.

## Source Index

- PX4 Gazebo/SITL: https://docs.px4.io/main/en/sim_gazebo_gz/
- PX4 prebuilt SITL packages: https://docs.px4.io/main/en/simulation/px4_sitl_prebuilt_packages
- PX4 safety/failsafes: https://docs.px4.io/main/en/config/safety.html
- MAVLink common messages: https://mavlink.io/en/messages/common.html
- ROS 2 Jazzy release: https://docs.ros.org/en/jazzy/Releases/Release-Jazzy-Jalisco.html
- ROS `nav_msgs`: https://docs.ros.org/en/jazzy/p/nav_msgs/index.html
- ROS `OccupancyGrid`: https://docs.ros.org/en/jazzy/p/nav_msgs/msg/OccupancyGrid.html
- MCAP spec: https://mcap.dev/spec
- ModalAI Starling 2 datasheet: https://docs.modalai.com/starling-2-datasheet/
- ModalAI VOXL 2: https://docs.modalai.com/voxl-2/
- Livox Mid-360 specs: https://www.livoxtech.com/de/mid-360/specs
- NVIDIA Jetson Orin Nano hardware docs: https://developer.nvidia.com/embedded/learn/jetson-orin-nano-devkit-user-guide/hardware_spec.html
- FAA Part 107: https://www.faa.gov/newsroom/small-unmanned-aircraft-systems-uas-regulations-part-107
- FAA Remote ID: https://www.faa.gov/uas/getting_started/remote_id
- FAA BVLOS proposed rule overview: https://www.faa.gov/newsroom/beyond-visual-line-sight-bvlos
- FAA BVLOS privacy/NPRM reference: https://www.transportation.gov/resources/individuals/privacy/normalizing-unmanned-aircraft-system-uas-beyond-visual-line-sight-0
- NIST SSDF: https://csrc.nist.gov/pubs/sp/800/218/final
- CISA SBOM: https://www.cisa.gov/sbom
- NIST Privacy Framework: https://www.nist.gov/privacy-framework
