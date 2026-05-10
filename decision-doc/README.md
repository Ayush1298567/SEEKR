# SEEKR Decision Workspace

Created: 2026-05-04

This folder contains a researched decision package for SEEKR, a GPS-denied search-and-rescue drone swarm concept.

## Files

- [SEEKR_FULL_SYSTEM_DECISION_DOC.md](SEEKR_FULL_SYSTEM_DECISION_DOC.md) - the main inline decision document with answers to every technical and logistical question.
- [SEEKR_MASTER_PLAN.md](SEEKR_MASTER_PLAN.md) - execution baseline and staged architecture.
- [SEEKR_RESEARCH_DOSSIER.md](SEEKR_RESEARCH_DOSSIER.md) - source-backed research synthesis.
- [SEEKR_DECISIONS_BY_SECTION.md](SEEKR_DECISIONS_BY_SECTION.md) - section-by-section decision matrix.
- [SEEKR_RISK_REGISTER.md](SEEKR_RISK_REGISTER.md) - live technical, safety, privacy, regulatory, and GTM risk register.
- [SEEKR_TEST_AND_ACCEPTANCE_MATRIX.md](SEEKR_TEST_AND_ACCEPTANCE_MATRIX.md) - automated and manual acceptance gates.
- [SEEKR_BUILD_BACKLOG.md](SEEKR_BUILD_BACKLOG.md) - strict build order.
- [SAFETY_CASE.md](SAFETY_CASE.md), [HAZARD_LOG.md](HAZARD_LOG.md), [FMEA_STPA.md](FMEA_STPA.md), and [FAILSAFE_MATRIX.md](FAILSAFE_MATRIX.md) - safety package.
- [FAA_REGULATORY_MATRIX.md](FAA_REGULATORY_MATRIX.md), [CONOPS.md](CONOPS.md), [COMMS_ICD.md](COMMS_ICD.md), [DATA_PRIVACY_SECURITY.md](DATA_PRIVACY_SECURITY.md), [OTA_POLICY.md](OTA_POLICY.md), [FLEET_OPERATIONS_MANUAL.md](FLEET_OPERATIONS_MANUAL.md), [MANUFACTURING_READINESS.md](MANUFACTURING_READINESS.md), and [GTM_AND_PRICING.md](GTM_AND_PRICING.md) - operations, regulatory, security, fleet, manufacturing, and GTM package.
- [research/SOURCES.md](research/SOURCES.md) - source index grouped by topic.
- [appendices/ASSUMPTIONS_AND_PUSHBACK.md](appendices/ASSUMPTIONS_AND_PUSHBACK.md) - the hard constraints and objections that should steer iteration.
- [appendices/EXECUTION_PLAN.md](appendices/EXECUTION_PLAN.md) - staged build plan, experiments, and order of operations.
- [diagrams/system-overview.md](diagrams/system-overview.md) - Mermaid diagrams for the current system architecture.

## Executive Decision

The original target, "6-inch, under ~350 g, with LiDAR + Jetson + thermal + RGB + UWB + long flight time," is not physically credible. SEEKR should split into two staged hardware tracks:

1. **V1: sub-350 g VIO prototype** using a tightly integrated platform such as ModalAI Starling 2 / VOXL 2, visual-inertial odometry, onboard RGB detection, no heavy LiDAR.
2. **V2: 450-900 g SAR payload platform** if 3D LiDAR, higher-resolution thermal, redundant radios, prop guards, and 25+ minute endurance are truly required.

The fastest credible path is simulation first, then one integrated VIO drone, then a three-drone controlled-environment swarm with pre-assigned zones. True multi-drone map fusion and BVLOS autonomy should be treated as V2/V3 regulatory and research programs, not MVP assumptions.
