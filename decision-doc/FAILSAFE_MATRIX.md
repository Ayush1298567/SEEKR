# SEEKR Failsafe Matrix

Created: 2026-05-04

| Case | V1 Simulator Behavior | Real Aircraft Default | Verification |
|---|---|---|---|
| Lost GCS link | Offline/degraded state, alert, assigned zone incomplete | PX4 data-link failsafe: configured hold/RTH/land; operator RC path | Link-loss scenario |
| Low battery | Return-home/hold and P2 alert | PX4 battery failsafe warn/return/land thresholds | Low-battery scenario |
| Estimator degradation | Block risky commands and alert | PX4 position-loss failsafe or mode change | Estimator fault test |
| Companion crash | Simulated adapter loss/stale data | Flight controller continues failsafe behavior independent of companion | Bench kill test |
| GCS failure | No real aircraft command in V1 | FC failsafe; independent RC/emergency stop | GCS kill test |
| Geofence breach | Command rejected if outside map/no-fly | PX4 geofence action configured | Validator and FC config |
| Drone collision risk | Cluster validator and one-investigator default | Onboard avoidance/separation procedure | Clustering test |
| Emergency stop | Not applicable to sim | RC/FC emergency action required | Preflight checklist |
| Detection false positive | Review workflow, no direct retask | Operator approval before retask | Detection review test |
| Stale map source | Stale layer and audit event | Do not use stale map for command authority | Stale source scenario |
