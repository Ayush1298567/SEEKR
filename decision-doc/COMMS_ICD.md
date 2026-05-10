# SEEKR Communications ICD

Created: 2026-05-04

## Internal API

- HTTP base: `http://127.0.0.1:8787/api`
- WebSocket: `ws://127.0.0.1:8787/ws`
- WebSocket envelope: `state.snapshot`, `state.delta`, `event`, `command.update`, `replay.tick`

## External Ingest Contracts

| Input | Endpoint | Contract |
|---|---|---|
| MAVLink telemetry fixture | `POST /api/ingest/telemetry` | HEARTBEAT, BATTERY_STATUS/SYS_STATUS, LOCAL_POSITION_NED/ODOMETRY, ESTIMATOR_STATUS, RADIO_STATUS normalize to `TelemetrySample` |
| ROS 2 occupancy grid fixture | `POST /api/ingest/map-deltas` | `nav_msgs/OccupancyGrid`-style payload normalizes to `MapDelta` |
| Detection fixture | `POST /api/ingest/detections` | Immutable `Detection` event; reviews are separate commands |
| Adapter events | `POST /api/ingest/adapter-events` | Non-authoritative adapter metadata |

## Priority Rules

Telemetry, command lifecycle, map deltas, detections, and alerts outrank video. Evidence references are hash/path based; raw media is not blindly embedded in mission state.
