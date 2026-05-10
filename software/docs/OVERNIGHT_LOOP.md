# SEEKR Overnight Loop

Use this when the machine should keep checking SEEKR while unattended.

```bash
npm run overnight
```

Defaults:

- Runtime: 8 hours.
- Sleep between cycles: 15 minutes.
- Keeps macOS awake with `caffeinate` while the loop runs.
- Writes logs to `.tmp/overnight/`.
- Writes current status to `.tmp/overnight/STATUS.md`.

Override timing:

```bash
SEEKR_OVERNIGHT_SECONDS=14400 SEEKR_OVERNIGHT_SLEEP_SECONDS=600 npm run overnight
```

Each cycle runs:

- `npm run check`
- `npm run test:ui`
- `npm run build`
- `npm run probe:preview`
- `npm run smoke:rehearsal:start`
- `npm run release:checksum`
- `npm run probe:hardware`
- `npm run probe:hardware:archive`
- `npm run bench:edge`
- `npm run bench:flight`
- `npm run bench:sitl`
- `npm run bench:sitl:io -- --fixture px4-process-io`
- `npm run bench:sitl:io -- --fixture ardupilot-process-io`
- `npm run bench:dimos`
- `npm run safety:command-boundary`
- `npm run test:ai:local`
- `npm run acceptance:record` after all prior steps pass
- `npm run probe:api` after acceptance recording passes

The rehearsal-start smoke runs after the production preview smoke and before the release checksum so each cycle proves the one-command operator wrapper can start on temporary local ports, expose API/client/source-health/readiness, keep command upload disabled, and shut down cleanly before recording release evidence.

The API probe runs last so it can see the final acceptance status from the same cycle. It checks config redaction, session acceptance status, passing acceptance release/checksum and command-boundary summaries when present, readiness, hardware readiness, source health, hash-chain verification, replay listing, and malformed JSON handling.

`STATUS.md` also lists remaining unchecked TODOs from both `docs/SEEKR_GCS_ALPHA_TODO.md` and `docs/SEEKR_COMPLETION_PLAN.md`.

The loop does not edit source code. It is a strict watchdog/checkpoint runner for the current implementation. Code changes still require an active coding agent session.
