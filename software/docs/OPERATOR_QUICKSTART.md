# SEEKR Operator Quickstart

## Start

1. Clone the GitHub handoff repository and enter the runnable app directory:

   ```bash
   git clone https://github.com/Ayush1298567/SEEKR.git
   cd SEEKR/software
   ```

   The runnable internal-alpha app lives under `software/`; the repository root also contains decision docs. If you already have the repo, run `git pull --ff-only` from the repository root before entering `software/` so the local start path matches the published handoff.

2. Install dependencies and prepare local operator files:

   ```bash
   npm ci
   npm run setup:local
   npm run audit:source-control
   npm run doctor
   ```

   `setup:local` creates `.env` only when missing and prepares project-local rehearsal data. `audit:source-control` records the current GitHub handoff state, including local HEAD publication and clean-worktree status, plus manual publication next steps without initializing Git, committing, or pushing. `doctor` checks package/runtime metadata, local Ollama, ports, data directory, source-control handoff state, and safety flags without starting the app; if the default ports are already occupied by a healthy SEEKR API/client, the port check passes and records those probe URLs. If default ports are occupied by a non-SEEKR or unhealthy listener and no port variables are explicitly set, the port check also passes because `npm run rehearsal:start` auto-selects free local API/client ports and prints the URLs it chose. Use the Listener diagnostics line to identify the process ID and working directory when you want to free the default ports. Stop the existing process or choose different explicit ports when explicitly configured occupied ports remain warnings. For final review packaging, rerun `doctor` after the bounded smoke proof so the operator-start doctor references the latest source-control handoff artifact.

3. Start the local rehearsal wrapper:

   ```bash
   npm run rehearsal:start
   ```

   The wrapper prepares local files without overwriting `.env`, normalizes `PORT` and `SEEKR_API_PORT` so the server and Vite proxy agree, fails fast if both are explicitly set to different values, refreshes source-control handoff evidence, runs the startup doctor, then starts the local server and client.

4. For a bounded preflight proof of the same path, run:

   ```bash
   npm run smoke:rehearsal:start
   ```

   This starts the wrapper on temporary local ports, checks API/client/readiness/source-health, writes `.tmp/rehearsal-start-smoke/`, then shuts down. It is local startup evidence only, not hardware validation. The smoke run refreshes source-control evidence and writes a smoke-profile doctor, so final review packaging should rerun standalone `npm run doctor` afterward.

5. Open the client URL printed by `npm run rehearsal:start`; by default it is `http://127.0.0.1:5173`.

6. If the run uses `SEEKR_INTERNAL_TOKEN`, open browser dev tools and set:

   ```js
   localStorage.setItem("seekr.internalToken", "the-token")
   ```

   Refresh the page.

## Local AI

- Keep Ollama running locally before the doctor and rehearsal start commands.
- Install the default local model before first use:

  ```bash
  ollama pull llama3.2
  ```

- The default model is `llama3.2:latest`; change it with `SEEKR_OLLAMA_MODEL` only after installing the replacement model locally.
- Before final review packaging, run:

  ```bash
  npm run test:ai:local
  ```

  This writes `.tmp/ai-smoke-status.json` with strict local AI smoke evidence: loopback Ollama URL, named Ollama scenarios, selected plan kinds, validator pass, no unsafe operator-facing text, and no mutation while thinking.
- AI output is advisory. It can help select from validated candidate plans, but it cannot create command payloads or bypass operator validation.

## Run A Rehearsal

- Use Start, Pause, Reset, and Scenario from the top control row.
- Use No-fly for local GCS planning constraints only. It does not upload geofences.
- Use Evidence Detail to inspect detections before review.
- Use Spatial to inspect local spatial asset metadata and preview geometry.
- Use Export before replay proof.
- Use Readiness, Sources, Verify, Report, and Incident Log as the audit evidence set.

## What Counts As Ready

- `npm run doctor` passes with only allowed soft warnings.
- `npm run smoke:rehearsal:start` passes for a bounded local startup proof.
- Readiness has no blocking failures.
- Hash-chain verification passes.
- Safety boundary passes.
- Source health has no unexpected stale or missing expected sources.
- Replay list includes the exported mission package.
- Report and incident log show the same final state hash as verify.
- `/api/config`, `/api/readiness`, `/api/source-health`, `/api/verify`, and `/api/replays` are available for evidence readback.
- `npm run audit:plug-and-play` reports local plug-and-play ready while preserving real-world blockers.

## What Is Not Allowed

- No real aircraft command upload.
- No real hold or return-home command.
- No AI-created command payloads.
- No operator answer bypassing validation.
- No hardware actuation.
- No claim that real-world blockers are cleared until the required Jetson, Raspberry Pi, MAVLink, ROS 2, HIL, Isaac, policy, and fresh-operator evidence exists.
