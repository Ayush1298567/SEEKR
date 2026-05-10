# SEEKR Execution Plan

## Recommended Order Of Operations

1. **Define V1 mission boundary.** One site, VLOS, controlled training environment, no BVLOS promise, no heavy LiDAR.
2. **Run simulation first.** PX4 multi-vehicle simulation with Gazebo/Isaac, simple occupancy maps, mock detections, and mission logs.
3. **Buy or build one integrated VIO drone.** Prefer ModalAI Starling 2 / VOXL 2 class hardware for speed.
4. **Prove single-drone GPS-denied flight.** VIO, local obstacle avoidance, low-battery behavior, lost-link behavior, and operator takeover.
5. **Add detection as advisory.** RGB first, thermal later. Detections create review events, not direct flight commands.
6. **Build the GCS map index.** Do not solve full global map fusion first. Show local maps, coverage, drone status, and detection locations.
7. **Move to three drones in controlled space.** Use pre-assigned zones and simple reassignment on failure.
8. **Add AI copilot behind validators.** LLM proposes plans; deterministic validators and operator approval own execution.
9. **Field-test comms.** Concrete, trees, multipath, and interference need real measurements.
10. **Only then evaluate LiDAR and true fusion.** Run FAST-LIO2/KISS-ICP/LIO-SAM and Kimera-Multi/COVINS/Swarm-SLAM experiments on logs.

## Six-Month Plan From 2026-05-04

| Date | Milestone | Output |
|---|---|---|
| 2026-05-31 | Scope lock | V1 mission envelope, hardware decision, source-of-truth repo/docs |
| 2026-06-30 | Simulation alpha | 3 simulated drones, simple zone assignment, mocked detection events |
| 2026-07-31 | Single-drone bench | VIO logs, onboard detector benchmark, safety state-machine draft |
| 2026-08-31 | Single-drone flight | GPS-denied hover/search pattern, lost-link/low-battery tests |
| 2026-09-30 | GCS alpha | Map-centric UI, QGC side-by-side workflow, detection review |
| 2026-10-31 | 3-drone controlled demo | Pre-assigned zones, failure reassignment, signed logs |
| 2026-11-30 | Operator feedback | 3-5 SAR/fire interviews or training-session reviews |
| 2026-12-15 | Pilot package | Demo video, safety log, technical plan, design-partner ask |

## Experiments To Run

### Hardware

- Weigh every component, cable, mount, and fastener.
- Compare Starling 2 VIO performance with a custom PX4/VOXL build.
- Measure flight time with and without prop guards.
- Measure vibration and VIO quality under motor/prop combinations.

### SLAM And Mapping

- Run OpenVINS/VOXL logs through drift and failure analysis.
- Benchmark FAST-LIO2, KISS-ICP, and LIO-SAM on a LiDAR dev rig if LiDAR remains on the roadmap.
- Test OctoMap versus Voxblox/ESDF for local planning and operator visualization.
- Create failure cases: repeated hallways, low texture, smoke/dust substitute, moving people, darkness.

### Detection

- Start with COCO/person pretraining and fine-tune on SARD, VisDrone, WiSARD, UMA-SAR, and internal data.
- Report false positive and false negative rates separately.
- Test tiny/partial human targets from realistic drone altitudes and angles.
- Test thermal alignment only after RGB baseline is stable.

### Comms

- Measure MAVLink telemetry reliability separately from video throughput.
- Test WiFi 6, dedicated mesh radio, LTE/5G backup, and LoRa emergency telemetry.
- Use store-and-forward for detections and map deltas.
- Do not count video as required for safety.

### UI

- Run tabletop exercises with operators.
- Measure time to notice a P1 detection, acknowledge it, inspect evidence, and retask one drone.
- Keep QGroundControl for flight-critical controls until a custom UI proves safer.

### Regulatory

- Build a living safety case: hazards, mitigations, tests, logs, operator procedures.
- Map every feature to Part 107, Remote ID, waiver/COA, and future Part 108 assumptions.
- Talk to an aviation lawyer before making BVLOS claims.

## Team Needs

- Robotics/flight stack engineer: PX4, MAVLink, VIO integration.
- Perception engineer: detection model, datasets, quantization, calibration.
- GCS/frontend engineer: map UI, telemetry, alert workflow.
- Systems/safety lead: failsafes, logs, test plans, regulatory package.
- Operator advisor: SAR/fire workflow, training, field constraints.

## V1 Definition Of Done

SEEKR V1 is done when three drones can search a controlled training area under VLOS, each with its own local autonomy, while the GCS shows coverage, status, detections, and logs, and the operator can safely approve retasking without direct piloting every motion.
