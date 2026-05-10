# SEEKR Master Plan

Created: 2026-05-04  
Status: V1 execution baseline  
Primary decision: build a local-first simulator/GCS/replay/research platform before buying aircraft or enabling real command authority.

## Executive Decision

SEEKR should be built in two tracks:

1. **V1: local-first simulator, GCS, replay, research, and evidence platform.** No hardware is assumed. The useful first product surface is deterministic simulation, event-sourced mission state, operator review, AI proposals behind validators, and exportable mission evidence.
2. **V2: read-only real drone ingest, then guarded command upload.** MAVLink/PX4 and ROS 2/SLAM adapters should ingest telemetry, detections, and map deltas before any hold/RTH/waypoint upload is enabled.

The original single-aircraft goal, "6-inch, under 350 g, with LiDAR + Jetson + thermal + RGB + UWB + long endurance," is rejected. V1 aircraft research stays VIO-first and no-LiDAR. If thermal, LiDAR, redundant radios, prop protection, and SAR durability are required, the aircraft moves to a 450-900 g+ V2 class.

## Locked Defaults

- **No hardware available now.** Work must be useful without aircraft.
- **V1 is not field-ready autonomous SAR.** V1 is a simulator/GCS/replay/research platform and a controlled-environment demonstration path.
- **PX4 SITL + Gazebo first.** ArduPilot SITL remains a comparison path.
- **ROS 2 Jazzy LTS concepts.** Use `nav_msgs`-style occupancy, pose, odometry, and path contracts.
- **MAVLink/PX4 contracts.** Normalize read-only telemetry first: heartbeat, battery, local pose/odometry, estimator quality, and link quality.
- **MCAP/NDJSON-style evidence.** Preserve replayable logs, snapshots, hashes, and evidence references.
- **AI advisory only.** LLMs may propose command drafts, but deterministic validators and operator approval own authority.
- **Part 107/VLOS first.** Treat Part 108/BVLOS as proposed or not operationally available unless re-verified at implementation time.

## System Architecture

```text
Layer 1 - Drone Edge (V2+ hardware path)
  PX4/ArduPilot flight stack
  VIO/LIO/SLAM
  Onboard detection
  MAVLink / ROS 2 / payload telemetry

Layer 2 - Local GCS (V1 product surface)
  Event-sourced mission engine
  Deterministic simulator
  Replay/export/evidence
  Map fusion testbed
  Operator UI
  AI tool boundary

Layer 3 - System / Ops / Safety
  Failsafe matrix
  CONOPS
  FAA/Remote ID/BVLOS readiness
  Privacy/security model
  OTA/fleet/manufacturing/GTM
```

## Build Phases

| Phase | Output | Acceptance Gate |
|---|---|---|
| 1. Paper system | Decision docs, research dossier, risk/test/backlog, safety/regulatory/security docs | Every SEEKR section has a decision, why, implementation path, test path, and pushback note |
| 2. Software core | Zod schemas, event log, reducer, command lifecycle, validators | State is rebuildable from append-only events |
| 3. Simulator and replay | Seeded scenarios, scripted faults, replay/export/import | Same scenario and seed reproduce the same final state and event sequence |
| 4. Operator GCS | Map layers, detections, evidence, command review, replay controls | Manual V1 scenario can be completed and exported from UI |
| 5. Real ingest | MAVLink, ROS 2 map, detection fixture adapters | UI shows real/fixture vehicle state without command authority |
| 6. Safety/ops | Hazard log, FMEA/STPA, failsafe matrix, FAA/privacy/OTA/fleet docs | No real command class is enabled without a covered safety case |
| 7. Guarded commands | Hold/RTH only, then focused search/waypoints later | Validators, approvals, and FC failsafes are proven on replay and fixtures |

## V1 Acceptance Definition

SEEKR V1 is acceptable when:

- Three simulated drones can search explicit zones under a deterministic seeded scenario.
- Coverage, detections, stale map sources, conflicts, battery, link quality, and estimator quality are visible in the GCS.
- Link loss, low battery, estimator degradation, drone dropout, duplicate detection, false positive, and stale map source faults are scripted and replayable.
- A drone dropout marks its assigned zone incomplete and produces a reassignment proposal.
- AI proposals cannot mutate mission state unless approved through the same command pipeline as operator actions.
- Exported mission bundles contain hash-chained events, snapshots, evidence references, schema/software metadata, and replay metadata.
- Replay reconstructs the same final state from the exported event log.

## V2 Entry Criteria

Do not buy or build real command-authority aircraft until V1 proves:

- Deterministic scenario replay.
- Reducer golden tests.
- Command lifecycle and validator matrix.
- Append-only persistence and tamper detection.
- Read-only MAVLink and ROS 2 ingest fixtures.
- Safety case coverage for the command class under consideration.

## Primary Sources

- ROS 2 Jazzy is the current LTS baseline to target for ROS-side contracts: https://docs.ros.org/en/jazzy/Releases/Release-Jazzy-Jalisco.html
- PX4 Gazebo/SITL supports local simulation and multi-vehicle workflows: https://docs.px4.io/main/en/sim_gazebo_gz/
- MAVLink common messages define HEARTBEAT, BATTERY_STATUS, LOCAL_POSITION_NED, ODOMETRY, ESTIMATOR_STATUS, and RADIO_STATUS contracts: https://mavlink.io/en/messages/common.html
- ROS `nav_msgs/OccupancyGrid` is the baseline 2D occupancy contract: https://docs.ros.org/en/jazzy/p/nav_msgs/msg/OccupancyGrid.html
- MCAP is a robotics logging container suitable for timestamped pub/sub replay data: https://mcap.dev/spec
- FAA Part 107 and Remote ID remain mandatory US regulatory baselines: https://www.faa.gov/newsroom/small-unmanned-aircraft-systems-uas-regulations-part-107 and https://www.faa.gov/uas/getting_started/remote_id
- FAA BVLOS/Part 108 material is proposed-rule readiness material, not a solved operating permission: https://www.faa.gov/newsroom/beyond-visual-line-sight-bvlos
