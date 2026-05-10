# SEEKR Data Privacy And Security

Created: 2026-05-04

## Defaults

- Local-first operation.
- Least-data retention.
- Raw imagery retained only when configured or evidence-linked.
- No facial recognition in V1.
- No customer evidence training without written opt-in.
- Append-only audit and hash-chained mission exports.
- Signed updates.
- SBOM and dependency scanning.
- Treat public-safety data as CJIS-adjacent even if not formally CJI.

## Evidence Model

Each evidence asset tracks MIME type, hash, URI/path, retention policy, redaction state, mission ID, optional detection ID, and metadata. Export manifests include evidence indexes and final state hash.

## Security References

- NIST SSDF SP 800-218: https://csrc.nist.gov/pubs/sp/800/218/final
- CISA SBOM: https://www.cisa.gov/sbom
- NIST Privacy Framework: https://www.nist.gov/privacy-framework
