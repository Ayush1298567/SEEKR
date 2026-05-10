# Research Tracks

The decision package was built from four parallel research tracks, then integrated into the main document.

## Track 1 - Hardware, SLAM, Detection

Scope: Sections 1-3.

Key findings:

- The original sub-350 g target cannot carry LiDAR + Jetson + thermal + RGB + UWB + redundant comms.
- The credible V1 path is a tightly integrated VIO platform such as ModalAI Starling 2 / VOXL 2.
- Flight-critical localization should be VIO first, not full SLAM.
- LiDAR should be evaluated on a larger V2 aircraft or separate dev rig.
- RGB detection should be advisory first; thermal should move to Boson-class hardware for field use.

## Track 2 - Autonomy, Comms, Safety, Regulatory

Scope: Sections 4, 5, 10, 11, 12.

Key findings:

- PX4/ArduPilot should own flight stabilization and failsafes.
- Companion autonomy should be subordinate to the flight controller.
- LLMs should not be in the safety loop.
- C2/telemetry must be separated from video/payload traffic.
- BVLOS is a regulatory/safety-case program, not just a software feature.

## Track 3 - Map Fusion, GCS AI, UI, Swarm

Scope: Sections 6-9 and DiMOS.

Key findings:

- V1 should use centralized GCS map indexing and pre-assigned zones.
- True multi-robot SLAM fusion belongs in V2.
- QGroundControl should remain available for flight-critical operations.
- The SEEKR UI should be map-centric and alert/evidence driven.
- DiMOS is useful as an MCP/skills architecture reference, but not as production flight or swarm infrastructure.

## Track 4 - Scalability, GTM, Data, Workflow

Scope: Sections 13-20.

Key findings:

- Early customers should be public-safety SAR/fire or US&R training teams, not FEMA headquarters.
- Pricing should bundle hardware, GCS software, training, and support.
- Data/privacy must be designed upfront because public-safety drone deployments face heavy scrutiny.
- The first six-month milestone should be credible pilot readiness, not full BVLOS deployment.
