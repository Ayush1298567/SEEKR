# Transcript-Derived Spatial Asset Strategy

Source context: `/Users/dullet/Ayush/Bilawal Transcripts` was scanned for Gaussian splats, 4D reconstruction, VPS/VSP, point clouds, digital twins, spatial intelligence, geospatial command views, and AI agent workflows.

## Ideas Pulled Into V1

- Gaussian splats and 4D reconstruction become local scene asset metadata, not embedded binary blobs.
- Point clouds and meshes use the same scene asset path for future LiDAR/photogrammetry references.
- VPS/VSP pose fixes become read-only localization corrections that update the local reducer state for operator awareness.
- Spatial video becomes a time-ranged asset reference that can be linked to detections and evidence.
- AI agent workflows become bounded read tools and candidate-plan selection, not autonomous command execution.
- Geospatial command views map to replay, timeline, report, evidence index, and tamper-check artifacts.

## Current V1 Surface

- `POST /api/ingest/spatial-assets`
- `POST /api/ingest/fixtures/spatial/:name`
- `query_spatial_assets`
- `explain_spatial_asset`
- Operator Spatial panel.
- Spatial map layer.
- Mission report Spatial Asset Summary.
- Replay/export adapter metadata for spatial assets.
- Three.js spatial viewer with deterministic lightweight previews.
- Bag-lite and spatial-manifest import endpoints.
- Spatial AI read tools for summaries, coverage gaps, correlation, ranking, VPS/VSP explanation, and search briefs.

## Safety Boundary

Spatial assets are advisory and local-first. Scene assets are URI-backed references. VPS/VSP pose fixes can improve the local GCS read model but do not authorize motion, upload commands, or override onboard navigation.

## Deferred

- Rendering actual `.splat`/point-cloud/mesh binaries in a 3D viewer.
- MCAP/ROS bag binary import for heavy spatial streams.
- RF sensing or Wi-Fi sensing adapters.
- Real-time shared spatial maps across multiple GCS stations.
- Any real aircraft command upload.
