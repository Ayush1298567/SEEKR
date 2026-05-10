# SEEKR Flight Software

This is the onboard flight-core track. It is separate from the GCS command API and starts in simulator/SITL mode only.

## What Exists Now

- Flight vehicle state model.
- Flight safety policy model.
- Command validator for arm, disarm, takeoff, waypoint, hold, return-home, land, and terminate.
- Failsafe evaluator for low battery, critical battery, heartbeat timeout, link loss, estimator degradation, and geofence breach.
- Deterministic onboard flight executive for simulator/SITL bench runs.
- Flight bench command:

  ```bash
  npm run bench:flight
  ```
- PX4/ArduPilot SITL bench command:

  ```bash
  npm run bench:sitl
  ```
- PX4/ArduPilot process IO harness for captured SITL stdout:

  ```bash
  npm run bench:sitl:io -- --fixture px4-process-io
  npm run bench:sitl:io -- --fixture ardupilot-process-io
  ```

The bench command runs a representative sequence:

1. arm
2. takeoff
3. waypoint
4. hold
5. return home
6. land
7. reject hardware actuation
8. reject unsafe geofence target
9. trigger critical-battery failsafe and reject non-recovery commands

## Hard Boundary

Real hardware actuation remains locked:

- No GCS route uploads aircraft missions.
- No MAVLink hold/RTH/upload is enabled.
- No ROS 2 navigation command/service/action is enabled.
- `FlightSafetyPolicy.allowHardwareActuation` defaults to `false`.
- Hardware transport commands are rejected unless a future hardware decision gate explicitly changes policy and tests.

This is intentional. A real aircraft should only be touched after SITL, HIL, failsafe, manual override, and regulatory checks are complete.

## Architecture

```text
src/flight/types.ts       Flight state, command, policy, failsafe, event contracts
src/flight/policy.ts      Default simulator/SITL safety policy and initial vehicle state
src/flight/safety.ts      Command validation and hardware lock
src/flight/failsafe.ts    Failsafe state machine
src/flight/executive.ts   Onboard deterministic flight executive
src/flight/bench.ts       Representative flight bench scenario
src/flight/sitl/          PX4/ArduPilot SITL command, telemetry, and process IO adapters
```

The flight core is pure TypeScript with no network or hardware dependency. That makes it testable before adapters are introduced.

## Next SITL Steps

1. Replace the deterministic process IO fixtures with real PX4/ArduPilot SITL capture streams.
2. Keep commands in `sitl` transport until bench evidence passes.
3. Persist SITL command/result traces separately from GCS mission events.
4. Add HIL tests that inject link loss, estimator degradation, low battery, and geofence breach.
5. Require manual override and physical E-stop evidence before any hardware actuation policy can be enabled.

## Hardware Gate Before Real Flight

Real flight command support requires:

- `npm run acceptance` passing.
- `npm run bench:edge` passing on the target edge machine.
- `npm run bench:flight` passing.
- `npm run bench:sitl` passing for both PX4 and ArduPilot mappings.
- `npm run bench:sitl:io -- --fixture px4-process-io` and `npm run bench:sitl:io -- --fixture ardupilot-process-io` passing, with `commandUploadEnabled: false`.
- Hardware readiness probe output from the actual Jetson/Pi.
- SITL logs and `npm run hil:failsafe:evidence` artifacts proving HIL failsafe behavior, manual override, physical E-stop verification, and `commandUploadEnabled: false`.
- `npm run policy:hardware:gate` evidence showing the candidate review package is complete while still reporting `realAircraftCommandUpload: false`, `hardwareActuationEnabled: false`, and `runtimePolicyInstalled: false`.
- A later reviewed code/policy change would be required to explicitly enable hardware actuation for a specific bench target. That change is outside V1.
