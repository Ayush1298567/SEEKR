# SEEKR CONOPS

Created: 2026-05-04

## V1 Concept Of Operations

SEEKR V1 runs locally on a GCS laptop as a simulator, replay, evidence, and operator-training system. The operator loads a scenario, starts a mission, monitors map coverage and drone health, reviews detections, approves or rejects AI proposals, exports a mission bundle, and replays the event log.

## V1 Actors

- Operator: owns mission decisions and approvals.
- Simulator: produces deterministic telemetry, map reveals, detections, and faults.
- AI copilot: drafts proposals and explanations only.
- Safety reviewer: reviews hazard/failsafe/test evidence before real command classes.

## V2 Read-Only Concept

The GCS connects to MAVLink/PX4 and ROS 2 fixtures or hardware streams without command authority. It normalizes telemetry, detections, and map deltas into the same mission event bus used by simulation.

## Future Real Command Concept

Only after safety gates pass, the GCS may upload hold/RTH commands through validators and operator approval. Waypoint/focused-search upload comes later.
