# Hardware Decision Gate

No aircraft purchase or command-upload recommendation is made in SEEKR V1.

Future hardware work requires:

- Validated replay and tamper-check artifacts from representative missions.
- Archived `/api/session`, `/api/config`, `/api/readiness`, `/api/source-health`, `/api/verify`, and `/api/replays` outputs for those missions.
- Closed safety-case review for hold, return-home, and mission-upload command classes.
- Adapter endpoint configuration, authentication, and operator approval rules.
- Proof that read-only MAVLink and ROS 2 bridges were rehearsed with expected-source warnings enabled and `npm run rehearsal:evidence -- --require-source ...` passing for the actual read-only sources used in the bench run.
- Archived `npm run probe:hardware -- --target jetson-orin-nano` or `--target raspberry-pi-5` output from the actual bench target.
- Archived `npm run probe:hardware:archive -- --target jetson-orin-nano` or `--target raspberry-pi-5` JSON/Markdown evidence from the actual bench target.
- Archived `npm run bench:flight` output proving simulator/SITL flight-core safety behavior.
- Archived `npm run bench:sitl` output proving PX4 and ArduPilot SITL mappings reject hardware transport by default.
- Archived `npm run bench:sitl:io -- --fixture px4-process-io` and `--fixture ardupilot-process-io` output proving process-facing SITL traces keep command upload disabled.
- Archived `npm run bench:dimos` output proving DimOS-style exported telemetry/map/detection/spatial evidence remains read-only.
- Archived `npm run hil:failsafe:evidence` output from an actual HIL run proving onboard failsafe behavior, manual override, E-stop verification, non-empty flight logs, and `commandUploadEnabled: false`.
- Archived `npm run isaac:hil:evidence` output from an actual Isaac Sim to Jetson bench run proving captured source data, Isaac source-health events, non-empty capture logs, and `commandUploadEnabled: false`.
- Archived `npm run policy:hardware:gate` output for a candidate review package. This gate must still report `commandUploadEnabled: false`, `realAircraftCommandUpload: false`, `hardwareActuationEnabled: false`, and `runtimePolicyInstalled: false`; it only makes a package ready for human review.
- Field test plan showing onboard failsafes remain authoritative.
- Regulatory and operational review for the intended test location.

Do not commit or install a runtime hardware-actuation policy in V1. The policy gate is a review-package validator, not a command-enable switch.
