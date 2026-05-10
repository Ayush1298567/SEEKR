# SEEKR V1 Safety Boundary

SEEKR V1 is a local simulator, GCS, replay, evidence, report, and read-only fixture integration platform.

Real MAVLink, ROS 2, or aircraft command upload is blocked. Adapter methods for hold, return-home, and mission upload return rejected command results until a future hardware decision gate and safety case approve those command classes.

AI proposals are draft-only. Approval creates normal command lifecycle events inside the local mission engine; it does not bypass validators or upload commands to vehicles.

When local Ollama/Llama is enabled, model output is treated as untrusted advisory text. The model receives a bounded state summary and a closed list of candidate plans. It can select a candidate and write rationale, but it cannot invent a new command payload, call APIs, or bypass validation. Malformed, unsafe, or out-of-range model output falls back to deterministic rules.

Passive plans are read-only. `GET /api/passive-plan` and the `generate_passive_plan` tool summarize watch items and next operator checks without appending events, creating command lifecycle records, or changing aircraft/GCS state.

Incident logs are read-only artifacts. `GET /api/missions/:missionId/incident-log` and the `export_incident_log` tool filter existing mission events, evidence metadata, command lifecycle records, and hash-chain status without creating new events or embedding binary evidence.

Operator input requests are prompts, not commands. `GET /api/operator-input-request` and the `request_operator_input` tool return sanitized questions and bounded choices; answers must still use existing review, proposal, or command-validation flows.

Local no-fly-zone changes are GCS planning constraints only in V1. They update the mission map and validators but do not upload geofences to aircraft.

Spatial assets are read-only/advisory context in V1. Gaussian splats, point clouds, meshes, 4D reconstructions, and spatial video are URI-backed references. VPS/VSP pose fixes can correct the local GCS read model for operator awareness and replay, but they do not authorize movement, upload waypoints, or override onboard navigation.

V2 import and preview endpoints remain local-first. Bag-lite records, spatial manifests, and generated Three.js preview geometry update only the event-sourced read model and operator display.

The server also rejects low-value model choices. If a validated action candidate exists, a model-selected `hold-drone` candidate is ignored and the deterministic priority candidate is used instead.
