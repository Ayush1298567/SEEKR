# Assumptions And Pushback

## Hard Pushback

1. **The original weight budget is not real.** A 260 g LiDAR plus Jetson Orin NX plus thermal plus RGB plus radios plus battery already exceeds the proposed sub-350 g aircraft before frame, motors, props, ESCs, fasteners, wiring, guards, and vibration isolation.
2. **SEEKR needs two hardware classes, not one.** A sub-350 g VIO prototype is credible. A LiDAR/thermal/redundant-radio SAR drone is likely 450-900 g or larger.
3. **V1 should not depend on true multi-drone SLAM fusion.** Multi-robot SLAM in GPS-denied environments is still research-heavy. V1 should use pre-assigned zones and a GCS map index before attempting global loop closure.
4. **The LLM cannot be safety-critical.** It can summarize, propose, prioritize, and explain. It should not command flight paths without deterministic validation and operator approval.
5. **BVLOS is not a software feature.** It is a regulatory, safety-case, C2-link, DAA, logging, training, and operations program.
6. **Mesh comms through concrete are not solved at consumer price points.** Design for store-and-forward, partial connectivity, and degraded operation from day one.
7. **SAR detection claims require a SEEKR-specific dataset.** COCO, VisDrone, SARD, WiSARD, and synthetic data are starting points, not proof of field reliability.
8. **Operator UI cannot be guessed.** Interview 3-5 SAR/fire operators before locking UI workflows.

## Working Assumptions

- Current date: 2026-05-04.
- Early geography: United States.
- Early deployment: VLOS training and controlled SAR exercises, not routine BVLOS disaster deployment.
- Early aircraft: integrated VIO platform such as ModalAI Starling 2 or equivalent PX4/VOXL platform.
- Early customer: public-safety SAR/fire or US&R training teams, not FEMA headquarters and not defense procurement.
- Early differentiator: swarm search workflow, offline autonomy, auditability, and SAR-specific detection/map UI.
- Early business model: paid pilots/evaluations, then hardware plus annual software/support.

## Decision Gate Criteria

Do not proceed from one stage to the next unless the prior stage meets these gates:

- **Simulation gate:** 3 simulated vehicles complete assigned zones, log detections, avoid overlapping tasks, and recover from one vehicle dropout.
- **Single-drone gate:** VIO holds position indoors/outdoors in GPS-denied conditions for 10+ minutes with bounded drift and clean failsafe behavior.
- **Detection gate:** onboard detector runs at 10+ FPS equivalent with measured false positives and false negatives on a representative test set.
- **Comms gate:** telemetry, detection metadata, and map deltas remain useful under degraded bandwidth; video is optional and on-demand.
- **Safety gate:** lost comms, low battery, estimator failure, companion crash, and emergency stop are tested and logged.
- **Customer gate:** at least two real operators validate the UI task flow before the app is treated as product design.
