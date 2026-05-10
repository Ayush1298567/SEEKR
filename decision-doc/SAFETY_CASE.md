# SEEKR Safety Case

Created: 2026-05-04  
Scope: V1 simulator/GCS/replay and V2 read-only ingest. Real command authority is explicitly excluded until command-class safety coverage is approved.

## Safety Claim

SEEKR V1 is safe to operate as a local simulation, replay, and operator-training system because it does not command real aircraft. SEEKR V2 read-only ingest is safe to connect to vehicles only when it cannot upload commands and the flight controller remains authoritative.

## Safety Boundary

- PX4/ArduPilot owns stabilization, arming, disarming, geofence failsafes, battery failsafes, RC loss, data-link loss, and emergency actions.
- SEEKR GCS owns mission awareness, logs, operator review, AI proposal drafts, replay, and evidence packaging.
- LLMs never own command authority.
- Real hold/RTH upload is a future command class requiring a reviewed safety case update.

## Required Evidence Before Real Commands

- Reducer golden tests.
- Command lifecycle tests.
- Validator matrix tests.
- Simulator determinism tests.
- Replay reconstruction tests.
- Hash-chain tamper detection tests.
- Read-only MAVLink/ROS fixture tests.
- Manual lost-link, low-battery, estimator, dropout, detection, reassignment, export, and replay scenario.

## Command Authority Gates

| Gate | Allowed | Blocked |
|---|---|---|
| V1 simulation | Sim commands and training auto | Real adapters |
| V2 read-only | Telemetry/map/detection ingest | Any MAVLink command upload |
| V2 guarded hold/RTH | Hold/RTH after safety review | Waypoints/focused search |
| V3 expanded autonomy | Waypoints/focused search after hold/RTH proof | BVLOS claims without authority |

## Residual Risk

The simulator can validate workflow and software contracts, but it does not prove field flight safety. Every real command class needs hardware bench tests, controlled flight tests, aviation legal/regulatory review, and operator procedures.
