# SEEKR

SEEKR is an internal-alpha ground-control and evidence system for local laptop rehearsal, read-only source visibility, local Ollama AI assistance, and review-bundle generation.

The runnable app is in [`software/`](software/). From a fresh machine, start with the published GitHub handoff:

```bash
git clone https://github.com/Ayush1298567/SEEKR.git
cd SEEKR/software
npm ci
npm run setup:local
npm run ai:prepare
npm run audit:source-control
npm run doctor
npm run plug-and-play
```

For day-to-day local startup, `npm run plug-and-play` is an alias for the same checked `npm run rehearsal:start` wrapper.

Before final local plug-and-play review, run the bounded startup, strict local AI, and readiness proof commands:

```bash
npm run smoke:rehearsal:start
npm run doctor
npm run test:ai:local
npm run smoke:fresh-clone
npm run audit:plug-and-play
```

If the repository is already cloned, run `git pull --ff-only` from the repository root first, then enter `software/` and use the same setup and rehearsal commands.

Source-control reference: <https://github.com/Ayush1298567/SEEKR>. Local rehearsal can run even when Git metadata is missing, but `software` also has a read-only source-control handoff audit that records this landing README's fresh-clone path, final AI and plug-and-play proof guidance, a shallow fresh-clone smoke proof, a published fresh-clone operator-start proof, GitHub publication, local HEAD, and clean-worktree state before review.

The local plug-and-play path keeps command upload and hardware actuation disabled. Real Jetson/Pi hardware validation, real MAVLink/ROS bench telemetry, HIL logs, Isaac Sim to Jetson capture, and reviewed hardware-actuation policy evidence are still required before the system can be treated as physically complete.

Key docs:

- [`software/docs/OPERATOR_QUICKSTART.md`](software/docs/OPERATOR_QUICKSTART.md): clone, setup, local AI, startup, evidence, and safety boundary instructions for an operator.
- [`software/README.md`](software/README.md): operator and evidence command guide.
- [`software/docs/DEVELOPER_QUICKSTART.md`](software/docs/DEVELOPER_QUICKSTART.md): local development and audit workflow.
- [`software/docs/goal.md`](software/docs/goal.md): current goal evidence, verification history, and remaining blockers.
