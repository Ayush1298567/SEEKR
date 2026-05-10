# SEEKR OTA Policy

Created: 2026-05-04

## Policy

- No blind auto-update.
- Signed releases only.
- Operator/admin approval for fleet rollout.
- Rollout stages: 1 unit, small batch, full fleet.
- Automatic rollback on health regression.
- Mission-critical operations should pin known-good versions.

## Release Requirements

- Versioned software/schema metadata.
- SBOM and dependency scan.
- Test matrix pass.
- Safety case impact review.
- Adapter command authority review.
- Rollback artifact retained.
