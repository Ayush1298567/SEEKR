import { describe, expect, it } from "vitest";
import { validateSpatialAssetForState } from "../domain/spatialAssets";
import { MissionStore } from "../state";

const now = 1_800_000_000_000;

describe("spatial asset ingest", () => {
  it("accepts Gaussian splat metadata and keeps it separate from map obstacles", () => {
    const store = new MissionStore({ clock: () => now });
    const occupiedBefore = store.snapshot().map.cells.filter((cell) => cell.occupied).length;

    store.ingestSpatialAsset(spatialAsset());

    const state = store.snapshot();
    expect(state.spatialAssets[0]).toMatchObject({ assetId: "spatial-test-splat", kind: "gaussian-splat", status: "aligned" });
    expect(state.map.cells.filter((cell) => cell.occupied).length).toBe(occupiedBefore);
  });

  it("applies VPS/VSP pose fixes to local estimator state only", () => {
    const store = new MissionStore({ clock: () => now });

    store.ingestSpatialAsset({
      ...spatialAsset(),
      assetId: "spatial-test-vps",
      kind: "vps-pose",
      uri: undefined,
      droneId: "drone-2",
      position: { x: 5, y: 15, z: 2 },
      confidence: 0.91,
      transformConfidence: 0.88,
      metadata: { technique: "visual-positioning-system", alias: "VSP/VPS" }
    });

    expect(store.snapshot().drones.find((drone) => drone.id === "drone-2")).toMatchObject({
      position: { x: 5, y: 15, z: 2 },
      mode: "vps-localized",
      sourceAdapter: "spatial-test"
    });
    expect(store.snapshot().commandLifecycles).toEqual([]);
  });

  it("rejects stale, low-transform, and out-of-bounds scene assets", () => {
    const store = new MissionStore({ clock: () => now });
    const state = store.snapshot();

    expect(validateSpatialAssetForState(state, { ...spatialAsset(), createdAt: now - 400_000 }, now).blockers).toContain("Spatial asset is stale and must be replayed or recaptured");
    expect(validateSpatialAssetForState(state, { ...spatialAsset(), transformConfidence: 0.1 }, now).blockers[0]).toContain("Spatial transform confidence");
    expect(validateSpatialAssetForState(state, { ...spatialAsset(), position: { x: 500, y: 500, z: 1 } }, now).blockers).toContain("Spatial asset anchor is outside mission map bounds");
  });
});

function spatialAsset() {
  return {
    assetId: "spatial-test-splat",
    kind: "gaussian-splat" as const,
    uri: "local://spatial/test/splat.splat",
    sourceAdapter: "spatial-test",
    frameId: "map",
    createdAt: now,
    position: { x: 8, y: 8, z: 1 },
    orientation: {},
    coordinateSystem: "mission-local" as const,
    confidence: 0.86,
    transformConfidence: 0.84,
    linkedDetectionIds: [],
    evidenceAssetIds: [],
    status: "pending" as const,
    renderHints: {},
    metadata: {}
  };
}
