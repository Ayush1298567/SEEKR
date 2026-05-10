# SEEKR - Full System Decision Doc

Created: 2026-05-04  
Status: researched working decision document  
Primary conclusion: SEEKR should be staged as a **VIO-first SAR swarm prototype**, then expanded into heavier LiDAR/thermal hardware only after single-drone autonomy and operator workflow are proven.

## Decision Key

- **V1** means the first credible prototype: controlled environment, VLOS, one to three drones, no routine BVLOS claim.
- **V2** means field-capable SAR: better sensors, redundant comms, stronger safety case, heavier airframe.
- **Pushback** means a requested assumption is likely wrong or too risky.

## System Overview

SEEKR is still best understood in three layers:

- **Layer 1 - Drone Edge:** flight, VIO/SLAM, onboard detection, autonomy, drone-side comms.
- **Layer 2 - Ground Control Station:** map fusion, AI/LLM copilot, operator UI, swarm coordination.
- **Layer 3 - System-Wide:** comms architecture, safety, FAA/regulatory, scalability, data/privacy, development process.

The load-bearing problems are **single-drone localization** and **operator-trustworthy mission workflow**. True multi-drone map fusion is important, but it should not block V1.

## 1. Flight & Hardware

### 1.1 - Frame Material

**Your answer:** Use carbon fiber for prototypes, then move to a hybrid frame for productization.

- **V1:** carbon fiber, preferably by using an existing integrated platform such as ModalAI Starling 2. It already has a 3 mm carbon fiber frame, VOXL2, VIO camera layout, and a published 285 g takeoff weight / >35 minute flight-time datasheet.
- **V2:** hybrid carbon fiber arms plus replaceable plastic/TPU center-shell and guard structures. SAR drones will hit walls, branches, and debris; brittle carbon-only frames are not enough for repeat field use.

Decision: **Option A for V1, Option C for product.**

### 1.2 - Frame Size

**Your answer:** Stop treating "6-inch under 350 g" as a hard target. Split the aircraft into two classes.

- **V1 sub-350 g:** use a tightly integrated 230 mm / 120 mm-prop VIO platform such as Starling 2. This is close to a small autonomous vision drone, not a classic 6-inch payload drone.
- **V2 sensor payload aircraft:** if LiDAR, higher-res thermal, redundant radio, UWB, prop guards, and 25+ minutes are all required, plan on a 6-7 inch or larger platform in the 450-900 g range.

Decision: **Option B only if LiDAR is dropped. Option C if LiDAR/thermal are required.**

### 1.3 - Battery Chemistry

**Your answer:** Use Li-Ion for endurance-focused SAR flight; use LiPo only for lab/agility testing.

Li-Ion has better energy density and fits the search mission better. LiPo makes sense for aggressive maneuvers and simple early bench flights, but SAR coverage rewards duration more than punch-out thrust.

Decision: **Option B - Li-Ion.**

### 1.4 - Flight Controller

**Your answer:** Use a PX4/ArduPilot-compatible autopilot, not a custom flight controller.

- **V1:** VOXL2 integrated autopilot on Starling 2, or Pixhawk-class controller if building custom.
- **Avoid:** custom ESP32/STM32 FC. Flight stabilization, failsafes, estimator integration, logs, and regulatory evidence are too much to rebuild.

Decision: **Option A equivalent - Pixhawk/PX4 class, or VOXL2 integrated PX4.**

### 1.5 - Motor/Prop Combo

**Your answer:** For V1, use the proven integrated Starling motor/prop stack. For custom V2, optimize for endurance, not racing thrust.

- If forced into a 6-inch custom build without LiDAR: efficient 6-inch props and lower-KV motors, likely bi-blade or low-pitch tri-blade.
- If carrying LiDAR/thermal/redundant comms: move to 7-inch with larger stators and Li-Ion.

Decision: **V1 integrated stack; V2 leans Option C, but with endurance props, not aggressive tri-blades.**

### 1.6 - Prop Guards / Bumpers

**Your answer:** Use lightweight TPU tip guards or partial guards for V1/V2. Use full ducts only for dedicated indoor close-quarters aircraft.

Full ducts are safer but burn too much endurance. No guards is not realistic around first responders, rubble, trees, or interiors.

Decision: **Option B - TPU tip guards / partial protection.**

### 1.7 - Target Flight Time

**Your answer:** Minimum acceptable field flight time is 25 minutes. Lab demos can accept 15 minutes.

V1 should target 20-30 minutes if using an integrated VIO platform. A 40+ minute target is not compatible with the full original payload unless the drone becomes much larger.

Decision: **Option B - 25 minutes.**

### 1.8 - Flag: Should We Reconsider "6-inch, Under 350 g"?

**Your notes:** Yes. The target should be rewritten.

Recommended wording:

> V1 target: sub-350 g VIO-based autonomous prototype with 20+ minute endurance.  
> V2 target: 450-900 g SAR payload platform with thermal, redundant comms, optional LiDAR, and 25+ minute endurance.

Pushback: a 260 g Livox Mid-360 alone consumes most of a 350 g aircraft budget. The original hardware stack is not a weight-budget issue; it is a physics issue.

## 2. Onboard SLAM

### 2.1 - Primary SLAM Sensor

**Your answer:** Use Visual-Inertial Odometry as the V1 primary localization sensor. Evaluate LiDAR only on a larger V2 aircraft or ground test rig.

VIO is not perfect in darkness, smoke, or feature-poor interiors, but it is the only path that matches sub-350 g. A LiDAR-first drone is a different aircraft class.

Decision: **Option B - VIO for V1. Option C/VI-LIO for V2 if the platform grows.**

### 2.2 - LiDAR Model

**Your answer:** No LiDAR on V1. If LiDAR survives into V2, test Livox Mid-360 on a larger platform.

- Livox Mid-360: good 3D coverage and common robotics support, but about 265 g before mount/cabling/power.
- 2D LiDAR options are lighter but weak for 3D SAR mapping.
- Ouster-class sensors are too expensive/heavy for the early system.

Decision: **None for V1. Option A only on a larger V2 dev rig.**

### 2.3 - SLAM Algorithm

**Your answer:** Use OpenVINS/VOXL VIO for flight-critical V1 odometry. Benchmark FAST-LIO2 and KISS-ICP if LiDAR is added.

- **Flight estimator:** OpenVINS / ModalAI OpenVINS server, because it is built for camera+IMU odometry and PX4 integration.
- **LiDAR odometry V2:** FAST-LIO2 for onboard efficiency.
- **Mapping/loop closure benchmark:** LIO-SAM for better graph-style mapping, but not as the first onboard estimator.
- **Visual research baseline:** ORB-SLAM3 is useful for benchmarking and map reuse, not for primary flight control.

Decision: **OpenVINS for V1; FAST-LIO2/KISS-ICP/LIO-SAM evaluation for V2.**

### 2.4 - Map Representation

**Your answer:** Use a layered map.

- **Onboard planning:** rolling local occupancy/ESDF map.
- **GCS global map:** OctoMap or multi-resolution OctoMap.
- **Logs/research:** point clouds/keyframes stored selectively, not streamed continuously.

Decision: **Option A - OctoMap for global occupancy, plus ESDF/local map for planning.**

### 2.5 - Handling Dynamic Objects

**Your answer:** Use semantic filtering in V1. Do not attempt full dynamic SLAM yet.

People, responders, vehicles, moving debris, and other drones should be filtered or tagged separately from static map structure. Full dynamic SLAM is a research problem and not worth blocking V1.

Decision: **Option B - semantic filtering.**

### 2.6 - Compute Target

**Your answer:** Use VOXL2/VOXL2 Mini-class compute for V1. If choosing from the Jetson options, Orin Nano is the only early candidate; Orin NX belongs on a larger aircraft.

- VOXL2 gives integrated autopilot, VIO pipeline, camera support, and low power.
- Jetson Orin Nano/Super is good for a bench or heavier custom drone.
- Orin NX is comfortable for SLAM+detection but not aligned with sub-350 g.

Decision: **VOXL2 for V1. If Jetson-only, Option A for V1 bench, Option B for larger V2.**

### 2.7 - Flag: FAST-LIO2 vs LIO-SAM And Budget

**Your notes:** FAST-LIO2 is the better onboard starting point if LiDAR is used. LIO-SAM is more attractive for mapping quality and loop closure but costs more compute and integration time.

Realistic per-drone budget:

- **VIO prototype:** $3K-$4K per drone using a platform like Starling 2.
- **VIO product BOM target:** $2K-$3K if volume and integration improve.
- **LiDAR/thermal professional platform:** $5K+ per drone BOM, likely $8K-$15K sale price.

## 3. Onboard Detection

### 3.1 - Detection Modality

**Your answer:** RGB for V1, RGB + thermal for field V2. Acoustic is a research add-on, not V1.

RGB-only is insufficient for night SAR, but it is the fastest path to a measured baseline. Thermal should be added once the airframe and detector pipeline can support it.

Decision: **Option C as product direction; RGB-only V1 baseline first.**

### 3.2 - Thermal Camera

**Your answer:** FLIR Boson 320 is the minimum serious field thermal option. Lepton is only a cheap prototype sensor.

- Lepton 3.5 is small and cheap but too low-res for many aerial survivor-detection cases.
- Boson 320 is expensive but much more useful.
- Boson 640 is ideal but pushes SEEKR into a professional price tier.

Decision: **Option B - FLIR Boson 320 for field V1/V2; Lepton only for early experiments.**

### 3.3 - Detection Model Architecture

**Your answer:** Start with YOLO nano/small class models exported to the target hardware runtime.

- On Jetson: YOLOv8n/YOLO11n + TensorRT.
- On VOXL: TFLite/NPU-compatible detector.
- Use segmentation as a secondary validation pass later, not V1.

Decision: **Option A - YOLO nano class first.**

### 3.4 - Training Data

**Your answer:** Start with transfer learning, then make SEEKR-specific data the real asset.

Primary source sequence:

1. COCO/person baseline.
2. Aerial SAR/drone datasets: SARD, VisDrone, WiSARD, UMA-SAR, Okutama-Action.
3. Synthetic data for rare conditions and augmentation.
4. Own field dataset from training exercises.

Decision: **All three, but transfer learning is the first source and own field data becomes the deciding source.**

### 3.5 - Handling False Positives

**Your answer:** Use multi-frame confirmation plus operator review. Do not wait for multi-drone confirmation before showing high-risk alerts.

Every detection should include evidence: frame crop, thermal/RGB if available, pose, map location, timestamp, confidence, and track history.

Decision: **Option A + Option B.**

### 3.6 - Acoustic Detection

**Your answer:** Skip acoustic detection for V1.

Prop noise makes this hard. Revisit later with a separate microphone-array module, active noise cancellation, and tests with the drone's own motor signatures.

Decision: **Option A - skip V1.**

### 3.7 - Flag: Segmentation And Prop Noise

**Your notes:** DeepLab/semantic segmentation is useful as a second-pass false-positive filter, especially for partial humans. Acoustic detection should be researched but not promised until rotor-noise suppression is demonstrated.

## 4. Onboard Autonomy

### DiMOS Question - Could We Use https://github.com/dimensionalOS/dimos?

**Your answer:** Yes, but only as an architecture reference and prototype tool layer.

Reusable:

- MCP-style robot skills.
- Typed module/stream pattern.
- Agent-facing tool boundary.
- Logging/replay/daemon lifecycle ideas.

Not reusable as production-critical:

- Flight safety.
- Multi-UAV swarm coordination.
- Production global map fusion.
- Certified command-and-control.

Decision: use DiMOS for a **1-2 week spike**: expose read-only telemetry/map tools and a no-op `propose_mission` tool. Do not put DiMOS in the flight path.

### 4.1 - Exploration Algorithm

**Your answer:** Use classical frontier exploration with information-gain scoring.

Frontier exploration is simple, explainable, and testable. Add information-gain weighting so the drone favors frontiers that improve coverage and reduce uncertainty.

Decision: **Option A with information-gain scoring from Option B.**

### 4.2 - Path Planner

**Your answer:** Use sampling-based planning for 3D candidate paths, plus local smoothing/control.

- V1: RRT/RRT* or kinodynamic sampling for 3D unknown environments.
- Known local grid: A*/Dijkstra is fine for short-range grid planning.
- Later: MPC for smooth, dynamic trajectories.

Decision: **Option B for 3D planning, with A as local fallback and MPC later.**

### 4.3 - Local Obstacle Avoidance

**Your answer:** Use VFH+ for V1 single-drone reactive avoidance. Add ORCA/RVO for multi-agent separation.

Decision: **Option A for V1; Option B for swarm deconfliction.**

### 4.4 - Behavior Architecture

**Your answer:** Use Behavior Trees.

Behavior Trees are readable, inspectable, testable, and common in robotics. BehaviorTree.CPP is a strong starting point.

Decision: **Option A - Behavior Tree.**

### 4.5 - "Curiosity" Definition

**Your answer:** Define curiosity as a weighted priority score.

Suggested score:

`priority = frontier_gain + uncertainty_reduction + detection_interest + operator_hint - risk_cost - battery_cost - comms_cost`

Decision: **Option D - combination with weighted priorities.**

### 4.6 - GCS Link Loss Behavior

**Your answer:** Continue for a bounded mission-specific interval, then return/hold/land based on battery, map, and safety state.

Default: continue for 5-10 minutes if safe, then return to last known comm point or home. For indoor missions without a safe route home, land in the safest mapped zone.

Decision: **Option C - continue for N minutes then RTH, configurable by mission.**

### 4.7 - Autonomy Policy Notes

**Your notes:** Routine frontier selection can be autonomous. Entering buildings, flying near people, crossing operator-defined boundaries, or clustering multiple drones on a detection should require operator approval in V1.

## 5. Drone-Side Comms

### 5.1 - Primary Drone-to-GCS Radio

**Your answer:** Use a dedicated long-range/high-reliability radio for serious field work; WiFi is acceptable for V1 lab data.

- V1 controlled tests: WiFi 6 for payload/map data plus MAVLink telemetry.
- Field product: Doodle Labs/Mesh Rider-class radio or equivalent for primary IP data/C2.
- LTE/5G: backup where coverage exists.

Decision: **Option B for field; Option A acceptable for lab.**

### 5.2 - Drone-to-Drone Mesh

**Your answer:** Use 802.11s/proprietary IP mesh for useful bandwidth, and LoRa only for emergency telemetry.

ESP32 BLE mesh and Zigbee are not enough for maps/video. LoRa is excellent for "alive, battery, pose estimate, last detection" emergency messages, not map sync.

Decision: **Option B plus LoRa emergency fallback.**

### 5.3 - Positioning / Ranging

**Your answer:** Use UWB as a supplemental ranging and deconfliction aid, not as the only position source.

UWB can help relative positioning, geofence anchors, and drone separation, especially GPS-denied. It still needs calibration, anchor geometry, and fusion with VIO/SLAM.

Decision: **Option A - UWB.**

### 5.4 - Protocol Stack

**Your answer:** Split protocols by function.

- Flight/control: MAVLink 2 with signing.
- Robotics data and internal GCS modules: ROS 2/DDS or a constrained message bus.
- Custom binary only where profiling proves it is necessary.

Decision: **Option A for flight, Option B for robotics data.**

### 5.5 - What Syncs When

**Your priorities:**

1. Emergency stop / safety command acknowledgement.
2. Critical safety alerts: collision risk, battery, estimator failure, geofence breach.
3. Person detections and evidence thumbnails.
4. Pose/status/health.
5. Coordination intent: assigned zone, current frontier, committed path.
6. Map deltas / coverage.
7. Video feed on-demand only.
8. Full logs after mission or when bandwidth allows.

### 5.6 - Offline Operation Duration

**Your answer:** Configurable per mission with hard safety limits.

Default: 10 minutes offline or until dynamic battery reserve says return sooner. If map confidence or estimator quality degrades, return/hold/land immediately.

Decision: **Option D - configurable per mission.**

### 5.7 - Comms Notes

**Your notes:** Mesh inside disaster buildings is a major engineering risk. Field-test in concrete and steel early. Simulations and open-field range numbers are not enough.

## 6. Global Map Fusion

### 6.1 - Fusion Approach

**Your answer:** Architect for hybrid fusion, implement centralized fusion first.

V1 should send compact local maps, pose graphs, detections, and coverage summaries to the GCS. Peer-to-peer map exchange can come later.

Decision: **Option C as architecture; Option A as V1 implementation.**

### 6.2 - Map Alignment Method

**Your answer:** Use multiple alignment cues, not one.

- Overlap exists: ICP / point-cloud registration.
- Visual overlap or revisits: visual place recognition.
- Site setup available: UWB anchors simplify alignment.

Decision: **Option B primary for cross-drone loop candidates, Option A when overlap exists, Option C when setup allows.**

### 6.3 - Global Map Data Structure

**Your answer:** Start with a global OctoMap, move to multi-resolution or tiled local maps as scale grows.

Decision: **Option A for MVP, Option B/C for scale.**

### 6.4 - Conflict Resolution Strategy

**Your answer:** Use probabilistic Bayesian merging with confidence weighting.

Most-recent-wins is too brittle. Sensor distance, timestamp, view angle, estimator confidence, and sensor modality should affect each update.

Decision: **Option B plus confidence weighting from Option C.**

### 6.5 - Compute Infrastructure

**Your answer:** Use a high-end GCS laptop for V1, not cloud.

A MacBook Pro/gaming laptop class GCS is portable and sufficient for three to five VIO drones if map products are compact. Use an edge workstation/truck later for larger deployments.

Decision: **Option A for V1.**

### 6.6 - Latency Target

**Your answer:** Near-real-time is the correct target.

Operators need reliable updates more than sub-500 ms map fusion. Safety-critical avoidance stays onboard.

Decision: **Option B - 1-5 seconds.**

### 6.7 - Flag: Is There A Simpler V1?

**Your notes:** Yes. V1 should assign each drone to a bounded zone and show each drone's local map in a shared GCS reference. True overlapping fusion and cross-drone loop closure should be V2.

## 7. GCS AI / LLM Layer

### 7.1 - LLM Role Definition

**Your answer:** Strategic copilot only.

The LLM can suggest zones, summarize evidence, prioritize detections, and explain mission state. It cannot own real-time flight control or safety actions.

Decision: **Option A - strategic only.**

### 7.2 - LLM Selection

**Your answer:** Hybrid.

- Cloud frontier model when available for planning/reasoning.
- Smaller/cheaper model for routine summaries.
- Local model fallback for offline field operation.

As of this document date, model names change quickly, so the exact model should be rechecked at implementation time.

Decision: **Option D - hybrid.**

### 7.3 - Framework

**Your answer:** Use LangGraph for stateful AI workflows and MCP-style tools for the fleet boundary.

LangGraph gives durable state/human-in-the-loop workflow. MCP gives a clean interface for bounded tools such as `query_map`, `estimate_coverage`, and `propose_search_plan`.

Decision: **Option A plus Option B.**

### 7.4 - Tool Design

**Your picks:**

- [x] `assign_drone_to_zone(drone_id, zone)` - requires validator and operator approval in V1.
- [x] `request_focused_search(coords, radius)` - proposes clustering; operator approves.
- [x] `acknowledge_detection(detection_id, severity)` - can draft severity, operator confirms.
- [x] `request_operator_input(question, options)` - yes.
- [x] `query_map(region)` - read-only, safe.
- [x] `abort_mission(drone_id)` - exposed only as a guarded safety/operator tool, not autonomous LLM discretion.
- [x] `estimate_coverage(region)` - yes.
- [x] `predict_survivor_location(hints)` - advisory only.

Additional tools:

- [x] `get_drone_status(drone_id)`
- [x] `validate_mission_plan(plan)`
- [x] `propose_zone_partition(region, drones)`
- [x] `set_no_fly_zone(region)` - operator-approved.
- [x] `export_incident_log(time_range)`
- [x] `explain_alert(alert_id)`

### 7.5 - Operator Trust Levels

**Your answer:** Default to semi-auto.

- **Default:** Semi-auto: LLM proposes, operator approves.
- **Advisory:** always available.
- **Full auto:** allowed only for low-risk routine actions in simulation/training or after explicit mission configuration.

### 7.6 - Safety Guardrails

**Your picks:**

- [x] Never command below dynamic battery reserve.
- [x] Never violate geofence or operator-defined boundary.
- [x] Never enter a building without operator approval.
- [x] Never command flight near known civilians/responders without approval.
- [x] Never dismiss or hide a high-confidence detection.
- [x] Never push more than a configured number of drones to one point.
- [x] Never alter, delete, or suppress audit logs.
- [x] Never override flight-controller failsafes.
- [x] Never issue commands if localization confidence is below threshold.

### 7.7 - Flag: Is LLM Reasoning Essential?

**Your notes:** No. The system should work without the LLM. LLM reasoning is a copilot layer and product differentiator, not a safety dependency.

## 8. Operator UI

### 8.1 - Platform

**Your answer:** Use a local web app against a local GCS server, side-by-side with QGroundControl for flight-critical controls.

Electron can wrap the web app later. Do not replace QGroundControl until SEEKR's custom UI has real operator validation.

Decision: **Option B - local web app, with QGC retained.**

### 8.2 - Map Library

**Your answer:** Use Cesium.js for outdoor/geospatial context and a custom Three.js/3D Tiles/voxel view for interior maps as needed.

Mapbox is too 2D for interior volumetric SAR. Unity/Unreal is too heavy for V1.

Decision: **Option A with selective custom Three.js.**

### 8.3 - Video Strategy

**Your answer:** Smart/on-demand video.

Show evidence clips and thumbnails automatically when detections occur. Stream high-rate video only when the operator selects a drone or detection.

Decision: **Option B + Option C.**

### 8.4 - Primary View Layout

**Your answer:** Map-centric.

The operator is managing coverage and detections, not watching ten live FPV feeds.

Decision: **Option A - map-centric.**

### 8.5 - Operator Actions

**Your list:**

1. Start/pause/end mission.
2. Draw or approve search boundary.
3. Assign drones to zones.
4. Approve/reject AI-proposed retask.
5. Inspect a detection and evidence clip.
6. Mark detection as confirmed, false positive, or needs follow-up.
7. Send one drone to focused search.
8. Command return/hold/land for one or all drones.
9. Set no-fly/avoid zones.
10. Export mission log / incident report.

### 8.6 - Alert Management

**Your answer:** Tiered alerts with acknowledge-to-dismiss workflow.

- P1: person detection, collision risk, emergency stop, flyaway, critical battery.
- P2: low battery, comms degradation, localization degraded, drone stuck.
- P3: routine status, coverage complete, map sync delayed.

Decision: **Option C with P1/P2/P3 tiers.**

### 8.7 - UI Hardware Notes

**Your notes:** Start with a rugged laptop or truck laptop. Add tablet as a companion viewer later. A truck-mounted workstation is useful for larger deployments, but not the first pilot.

## 9. Swarm Coordination

### 9.1 - Coordination Paradigm

**Your answer:** Hybrid.

The GCS does strategic zone allocation when connected. Drones handle local avoidance and continue bounded missions when disconnected.

Decision: **Option C - hybrid.**

### 9.2 - Zone Assignment Algorithm

**Your answer:** Explicit assignment for V1, auction/CBBA-style allocation for V2.

Explicit zones are debuggable and operator-friendly. CBBA/auction allocation becomes useful when dynamic tasks and more drones are added.

Decision: **Option C for V1, Option B for V2.**

### 9.3 - Cluster-on-Detection Behavior

**Your answer:** One nearest capable drone investigates by default; operator decides whether to cluster more.

Automatically sending three drones can create coverage gaps and collision risk.

Decision: **Option C default, with Option B as automatic low-risk behavior.**

### 9.4 - Drone Failure Recovery

**Your answer:** Mark the failed drone's zone incomplete, then redistribute to nearest neighbors if safe.

Decision: **Option A plus Option B.**

### 9.5 - Seamless Drone Add

**Your answer:** Auto-suggest assignment to the largest uncovered region after health checks; operator approves in V1.

Decision: **Option A with operator confirmation.**

### 9.6 - Coordination Communication Frequency

**Your answer:** Event-driven updates plus periodic heartbeat/batch sync.

Continuous 100 ms sync is too bandwidth-heavy. Pure event-driven can miss liveness and stale state.

Decision: **Option C with event-driven urgent updates.**

### 9.7 - Swarm Notes

**Your notes:** Use explicit coordination first. Emergent coordination is interesting but hard to certify, debug, and explain to first responders.

## 10. Comms Architecture

### 10.1 - Primary Link Topology

**Your answer:** Hybrid: star primary, mesh fallback.

Each drone should try to talk to GCS directly when possible. Mesh relay helps deep indoor/blocked cases but should not be the only design.

Decision: **Option C - hybrid.**

### 10.2 - Radio Redundancy

**Your answer:** Primary plus backup radio for field systems.

V1 lab can run single radio. Field SAR needs at least a low-rate backup path for health, return, and detection metadata.

Decision: **Option B.**

### 10.3 - GCS Antenna Strategy

**Your answer:** Multiple omni antennas / diversity first; tracking directional antenna later.

Directional antennas help range but complicate deployment. Multi-omni/diversity is more field-friendly.

Decision: **Option C.**

### 10.4 - Bandwidth Management Strategy

**Your strategy:**

- Separate control/telemetry from payload data.
- Never let video starve MAVLink safety traffic.
- Adaptive bitrate and frame-rate control per drone.
- Stream video on-demand.
- Send detection metadata and thumbnails before full images/video.
- Send map deltas, not full maps.
- Store full logs onboard and sync after reconnection.
- Use QoS classes: safety, command, detection, pose, map, video, bulk logs.

### 10.5 - Comms Notes

**Your notes:** Field-test early in concrete, wooded, and vehicle-heavy environments. Bench throughput is not a deployment guarantee.

## 11. Safety & Failsafes

### 11.1 - Lost Comms Policy

**Your answer:** Same as 4.6: continue for a bounded configured interval if safe, then return to last comm point/home or land in safe mapped area.

### 11.2 - Low Battery Reserve

**Your answer:** Dynamic reserve.

Reserve should depend on distance to home/landing zone, wind, payload, battery health, and route confidence. Use conservative fixed thresholds until dynamic logic is validated.

Decision: **Option C - dynamic.**

### 11.3 - Mid-Air Collision Avoidance

**Your answer:** Combine SLAM/UWB separation with ORCA/RVO-style multi-agent avoidance.

Decision: **Option B with Option A as sensor basis.**

### 11.4 - Geofencing GPS-Denied

**Your answer:** Use SLAM-relative boundaries for mapped/defined zones and UWB anchors when site setup allows.

- Training/structured sites: UWB anchors are worth it.
- Disaster response: operator-drawn SLAM-relative boundaries are more practical.
- Visual markers are useful in training but not field-reliable.

Decision: **Option B default, Option A when anchors can be deployed.**

### 11.5 - Emergency Stop

**Your answer:** Physical hardware kill-switch plus wireless safety command.

Software-only is not enough. The kill mechanism must be tested and logged.

Decision: **Option A + Option B.**

### 11.6 - Failure Mode Coverage

**Your notes per case:**

- **Motor out:** small quadrotor usually cannot sustain flight; command controlled descent/land if possible, otherwise controlled crash away from people.
- **LiDAR dies:** V1 has no LiDAR. V2 should degrade to VIO if available, otherwise RTH/land.
- **Camera/VIO failure:** hover/land if optical flow/altitude support exists; otherwise controlled land. Do not continue autonomous exploration.
- **Thermal camera failure:** continue search with RGB, flag degraded detection capability.
- **Detector failure:** continue mapping/search, but mark detection unavailable.
- **Companion computer freeze:** hardware watchdog exits offboard/autonomy and flight controller executes hold/land/RTH.
- **GCS failure:** drones continue bounded behavior, then RTH/land.
- **GPS spoofing:** do not rely on GPS indoors; outdoors cross-check GNSS against VIO/IMU and reject inconsistent jumps.
- **Battery sag:** abort mission and return/land before critical threshold.
- **UWB failure:** continue with VIO/SLAM, but increase separation margins and disable UWB-dependent geofence.

### 11.7 - Safety Notes

**Your notes:** Create a living hazard log now. Every test should produce logs for failsafe triggers, operator commands, estimator quality, battery state, and comms quality.

## 12. Regulatory / FAA

### 12.1 - Deployment Path

**Your answer:** Use public-safety partnerships and customer COA/waiver paths while building a waiver-ready system.

The startup should not assume it can independently deploy routine BVLOS SAR early. Work with agencies, training sites, and aviation counsel.

Decision: **Option C - joint path.**

### 12.2 - First Operational Domain

**Your answer:** Controlled training environment first, then rural/wilderness SAR. Urban disaster is later.

Controlled training gives safe data and operator feedback. Rural SAR is easier than urban collapse from a regulatory and comms standpoint. Urban disaster is the hardest case.

Decision: **Option C first validation, Option A first real operational target.**

### 12.3 - Remote ID Compliance

**Your answer:** Use off-the-shelf Remote ID modules for prototypes if needed; integrate standard Remote ID in product hardware where possible.

Decision: **Option A prototype, Option B product.**

### 12.4 - Insurance / Liability

**Your answer:** Hybrid.

Customer covers operations liability; SEEKR carries manufacturer/product/professional liability and supports waiver documentation.

Decision: **Option C.**

### 12.5 - FAA Notes

**Your notes:** As of 2026-05-04, Part 108/BVLOS is proposed, not a final routine operating path. Design toward it, but sell/test under today's Part 107, COA, waiver, and training-environment constraints. Talk to an aviation lawyer before making BVLOS claims.

## 13. Scalability

### 13.1 - BOM Target

**Your answer:** Target $2K-$3K BOM for a VIO-only drone; accept $5K+ BOM for professional LiDAR/thermal.

Trying to force LiDAR/thermal into a $1K-$1.5K BOM will break the product.

Decision: **Option B for VIO product, Option C for professional SAR payload.**

### 13.2 - Manufacturing Path

**Your answer:** Hybrid.

Use off-the-shelf/in-house builds for V1. Move to contract manufacturing only after design stabilizes.

Decision: **Option C - in-house V1, CM V2.**

### 13.3 - Software Pricing Model

**Your answer:** Hardware-included plus monthly/annual platform fee.

Public-safety customers need training, support, logs, updates, and compliance. One-time software licenses underfund the product.

Decision: **Option D.**

### 13.4 - Fleet Management Strategy

**Your answer:** Hybrid local primary plus cloud sync when online.

The system must work offline at the incident site. Cloud is for fleet oversight, updates, post-mission review, and support.

Decision: **Option C.**

### 13.5 - OTA Update Strategy

**Your answer:** Staged rollouts with rollback.

Never auto-update an operational fleet blindly. Updates should be signed, staged, testable, and reversible.

Decision: **Option C.**

### 13.6 - Primary Early Customer Constraint

**Your notes:** Primary early customer should be public-safety SAR/fire or US&R training teams with existing drone interest and a controlled training environment. FEMA/federal disaster response is too slow as a first buyer.

## 14. Target Customer

**Your primary target:** County/state SAR and fire/rescue agencies that already operate drones or train for US&R/wilderness SAR.

Best first buyers:

- Regional fire departments with drone teams.
- County sheriff SAR teams.
- State emergency-management training groups.
- US&R training centers/firefighter academies.

**Your secondary target:** Industrial emergency response for mining, oil/gas, utilities, and large campuses where GPS-denied search and inspection overlap.

Avoid first:

- FEMA headquarters as the initial sales motion.
- Defense-first procurement unless using non-dilutive grants.
- Small agencies with one manually flown drone and no budget for autonomy.

## 15. Pricing Model

Reference points:

- Skydio X10 and enterprise/public-safety drones sit in a much higher price tier than consumer drones.
- DJI Matrice-class systems can reach $10K+ with payloads.
- Research swarm platforms commonly land in the $2K-$5K per-drone range before support.

**Your pricing draft:**

- **Hardware per VIO drone:** $4K-$7K sale price early; lower with volume.
- **Hardware per thermal/LiDAR-capable drone:** $8K-$15K+ sale price.
- **GCS software:** $2K-$10K/month depending fleet size, support, integrations, and retention/audit features.
- **Training/onboarding:** $10K-$25K per customer.
- **Support contract:** 15-20% of annual hardware/software value, or bundled into subscription.

**Your model:** sell pilot kits first: 3 drones + GCS + training + support for a controlled pilot. Then move to annual platform subscriptions.

## 16. Competitive Positioning

### Differentiation Checklist

- [x] SAR-specific, not generic inspection.
- [x] Swarm coordination, not single-drone piloting.
- [x] More affordable than defense swarm platforms.
- [ ] Consumer-addable in V1. This should wait until safety/provisioning is mature.
- [x] Onboard autonomy plus GCS copilot.
- [x] Open architecture around MAVLink/PX4/ROS 2/QGC-style tooling.

### Top 3 Differentiators

1. **SAR-specific swarm search workflow:** coverage, detections, zones, evidence review, and failure recovery.
2. **Offline-first autonomy and GCS:** works when internet/cellular is degraded.
3. **Auditable open architecture:** MAVLink/PX4/ROS 2-compatible, with logs and deterministic safety boundaries.

### Competitive Pushback

Do not position SEEKR as "better than Skydio/DJI" broadly. Position it as a SAR swarm workflow and map/detection layer that can eventually integrate with other aircraft.

## 17. Roadmap

Assuming start date is 2026-05-04:

| Milestone | Target Date | Decision |
|---|---:|---|
| M1 - Simulation: multi-drone search, mock SLAM/fusion, zone coordination | 2026-07-31 | Must precede hardware swarm |
| M2 - Single drone hardware: VIO + detection + safety logs | 2026-09-30 | Use integrated VIO platform |
| M3 - Three-drone controlled environment | 2026-12-15 | Pre-assigned zones first |
| M4 - First outdoor field test with friendly SAR/fire team | 2027-03-31 | VLOS and controlled |
| M5 - FAA waivers / first pilot customer package | 2027-06-30 | Regulatory counsel involved |
| M6 - First paying deployment/pilot | 2027-09-30 | Training environment or limited ops |
| M7 - Manufacturing scale-up | 2028-06-30 | Only after design freeze |

## 18. Funding Path

**Your current stage:** concept / pre-prototype unless a working flight demo already exists.

**Target next round:** pre-seed after simulation demo, single-drone proof, and 2+ design-partner LOIs.

Recommended:

- Non-dilutive: NSF SBIR, DHS S&T, public-safety robotics grants, state innovation grants.
- Pre-seed: $500K-$1.5M after credible demo and LOIs.
- Seed: $2.5M-$5M after paid pilots or strong agency/OEM design partner.

Pushback: do not raise on "drone swarm TAM" alone. Raise on tested GPS-denied autonomy, operator validation, and a credible regulatory path.

## 19. Data & Privacy

**Your policies:**

- Customer owns all mission data.
- Raw survivor video/images retained only when needed and explicitly configured.
- Default retention: 30-90 days for non-evidence flight data; legal hold for incident-linked data.
- Operator actions are logged for audit.
- AI decisions/proposals are logged with inputs, outputs, tool calls, validator result, and operator approval.
- No facial recognition in V1.
- No training on customer evidence without written opt-in.
- Encryption in transit and at rest.
- Signed/tamper-evident mission logs.
- Public transparency export should be available for agencies that need it.
- Treat data as CJIS-adjacent for security posture even when not formally criminal-justice information.

## 20. Development Workflow

**Your setup:**

- **Version control:** GitHub.
- **Repo structure:** flight integration, GCS, perception, simulation, docs, test data.
- **CI/CD:** required for GCS, AI tools, simulation tests, schemas, and static analysis. Flight firmware updates require staged release gates.
- **Simulation:** PX4 SITL multi-vehicle plus Gazebo/Isaac Sim scenarios.
- **Hardware-in-the-loop:** required before field deployment.
- **Logging format:** MCAP/ROS bag style logs plus MAVLink telemetry export.
- **Documentation:** Markdown docs in repo as source of truth.
- **Issue tracking:** decisions, hazards, test failures, and operator feedback should be tracked as first-class issues.
- **Release process:** signed builds, changelog, rollback plan, staged rollout.

## Parking Lot / Things To Ask

### What's the realistic timeline?

Recommended six-month target: credible simulation, one working VIO drone, early GCS UI, and operator/design-partner feedback. A field-ready BVLOS swarm is not a six-month goal.

### How much should technical perfect block V1?

Do not wait for perfect multi-drone SLAM. V1 should knowingly compromise:

- VIO, not LiDAR.
- Pre-assigned zones, not full emergent swarm.
- Map index, not perfect fused map.
- LLM copilot, not LLM control.
- VLOS/training, not BVLOS deployment.

### Who needs to be on the team?

Minimum serious team:

- Flight/robotics engineer.
- Perception/detection engineer.
- GCS/frontend engineer.
- Systems/safety/regulatory owner.
- SAR/fire operator advisor.

### First 6-month goal

The best first goal is **credible pilot readiness**, not investor theater:

- One drone flies GPS-denied search pattern.
- Detector creates reviewable events.
- GCS shows map/coverage/detections.
- Three-drone sim works.
- Safety logs exist.
- Two real operators say the workflow solves a problem.

## Final System Decision

Build SEEKR V1 as:

- VIO-first, sub-350 g if using integrated hardware.
- PX4/MAVLink-based.
- Map-centric GCS with QGroundControl retained.
- Explicit zone-based swarm coordination.
- RGB detection first, thermal after baseline.
- LLM as semi-auto copilot only.
- Offline-first logs and mission operation.
- Regulatory path through controlled VLOS tests, agency partnerships, and later waiver/COA work.

Defer until V2:

- Heavy 3D LiDAR onboard.
- True decentralized multi-robot SLAM.
- Routine BVLOS.
- Full acoustic survivor detection.
- Emergent swarm behavior.
- Consumer-addable drones.
