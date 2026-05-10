# SEEKR V2 Spatial AI Ops

V2 extends the V1 local-first simulator/GCS/replay/evidence platform with spatial command intelligence. It remains read-only with respect to real aircraft.

## Implemented Surface

- Three.js spatial viewer for lightweight previews of Gaussian splats, point clouds, meshes, 4D reconstructions, spatial video, and VPS/VSP pose fixes.
- Spatial preview APIs under `GET /api/spatial-assets/:assetId/preview`.
- Local import endpoints for spatial manifests, bag-lite JSON streams, and hash-checked mission event logs.
- Spatial AI read tools: scene summaries, 3D coverage gaps, detection/evidence correlation, VPS/VSP pose explanation, spatial asset ranking, and search briefs.
- Mission reports and replay export metadata include spatial render/import summaries.

## Boundaries

- Heavy real `.splat`, point-cloud, mesh, video, MCAP, or ROS bag binaries are not embedded in mission state.
- Preview geometry is lightweight and deterministic.
- Local Llama remains advisory and can only select server-built candidate plans.
- Real command upload remains blocked.

## Acceptance

Run:

```bash
npm run check
npm run test:ai:local
npm run test:ui
npm run build
```

Expected operator workflow:

- Start mission.
- Ingest or import spatial assets.
- Open the 3D spatial viewer.
- Run AI proposal/brief workflows.
- Export report and replay with spatial metadata intact.
