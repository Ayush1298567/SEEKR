# SEEKR

SEEKR is an internal-alpha ground-control and evidence system for local laptop rehearsal, read-only source visibility, local Ollama AI assistance, and review-bundle generation.

The runnable app is in [`software/`](software/). Start there:

```bash
cd software
npm ci
npm run setup:local
npm run doctor
npm run rehearsal:start
```

Source-control reference: <https://github.com/Ayush1298567/SEEKR>. Local rehearsal can run even when Git metadata is missing, but `software` also has a read-only source-control handoff audit that records GitHub publication, local HEAD, and clean-worktree state before review.

The local plug-and-play path keeps command upload and hardware actuation disabled. Real Jetson/Pi hardware validation, real MAVLink/ROS bench telemetry, HIL logs, Isaac Sim to Jetson capture, and reviewed hardware-actuation policy evidence are still required before the system can be treated as physically complete.

Key docs:

- [`software/README.md`](software/README.md): operator and evidence command guide.
- [`software/docs/DEVELOPER_QUICKSTART.md`](software/docs/DEVELOPER_QUICKSTART.md): local development and audit workflow.
- [`software/docs/goal.md`](software/docs/goal.md): current goal evidence, verification history, and remaining blockers.
