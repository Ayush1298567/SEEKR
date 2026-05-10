# SEEKR Local Threat Model

## Scope

SEEKR V1 is a local GCS, simulator, replay, evidence, report, and read-only fixture integration platform. It is not flight firmware and is not a public web service.

## Trust Assumptions

- The operator controls the field laptop.
- The server binds to `127.0.0.1`.
- Rehearsal users are local and trusted, or `SEEKR_INTERNAL_TOKEN` is set.
- Fixture, import, detection, and spatial metadata may contain untrusted content and prompt-injection attempts.
- Local Ollama output is untrusted advisory text.

## Assets

- Mission event log: `mission-events.ndjson`.
- Replay manifests under `replays/`.
- Latest state snapshot.
- Evidence metadata and URI references.
- Internal token, if configured.
- Final state hash and incident log.

## Main Risks

- Accidentally exposing mutating API routes during a rehearsal.
- Treating imported metadata or AI output as executable instructions.
- Losing event/replay evidence after a rehearsal.
- Confusing local planning constraints with aircraft geofence upload.
- Adding real adapter command paths before the hardware decision gate.

## Controls

- Optional `SEEKR_INTERNAL_TOKEN` protects mutating routes.
- `/api/config` and `/api/session` redact secrets.
- AI proposals select only validator-built plans.
- Passive plans, readiness, source health, incident logs, reports, and operator input prompts are read-only.
- MAVLink and ROS 2 command methods reject upload, hold, and return-home.
- Readiness probes the safety boundary every time.
- Source health can require expected adapters through `SEEKR_EXPECTED_SOURCES`.

## Out Of Scope For V1

- Public internet hosting.
- Multi-user auth.
- Real aircraft control.
- Secure binary evidence storage.
- Signed release distribution.
