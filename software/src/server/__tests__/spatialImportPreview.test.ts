import { describe, expect, it } from "vitest";
import { buildSpatialPreview } from "../domain/spatialPreview";
import { importBagLite, importSpatialManifest } from "../importers/bagLiteImporter";
import { MissionStore } from "../state";

const now = 1_800_000_000_000;

describe("spatial V2 import and preview", () => {
  it("imports spatial manifests through normal spatial asset events", () => {
    const store = new MissionStore({ clock: () => now });

    const summary = importSpatialManifest(store, {
      importId: "test-manifest",
      assets: [spatialAsset("manifest-splat-1")]
    });

    expect(summary).toMatchObject({ ok: true, counts: { "gaussian-splat": 1 }, rejected: [] });
    expect(store.snapshot().spatialAssets).toEqual(expect.arrayContaining([expect.objectContaining({ assetId: "manifest-splat-1" })]));
    expect(store.allEvents().map((event) => event.type)).toEqual(["spatial.asset.ingested", "import.completed"]);
  });

  it("imports bag-lite records with partial rejection", () => {
    const store = new MissionStore({ clock: () => now });

    const summary = importBagLite(store, {
      importId: "test-bag",
      records: [
        {
          type: "telemetry",
          sample: {
            sampleId: "bag-telemetry-test",
            droneId: "drone-1",
            receivedAt: now,
            heartbeat: true,
            position: { x: 8, y: 8, z: 2 },
            sourceAdapter: "bag-lite"
          }
        },
        { type: "spatialAsset", asset: spatialAsset("bag-splat-1") },
        { type: "bad-record" }
      ]
    });

    expect(summary).toMatchObject({
      ok: false,
      counts: { telemetry: 1, spatialAsset: 1 },
      rejected: [expect.objectContaining({ type: "bad-record" })]
    });
    expect(store.snapshot().spatialAssets[0]).toMatchObject({ assetId: "bag-splat-1" });
  });

  it("builds deterministic nonblank spatial previews", () => {
    const store = new MissionStore({ clock: () => now });
    store.ingestSpatialAsset(spatialAsset("preview-splat-1"));
    const asset = store.snapshot().spatialAssets[0];

    const preview = buildSpatialPreview(asset, store.snapshot());

    expect(preview.points.length).toBeGreaterThan(20);
    expect(preview.points[0]).toMatchObject({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number), color: expect.any(String) });
    expect(preview.generated).toBe(true);
  });
});

function spatialAsset(assetId: string) {
  return {
    assetId,
    kind: "gaussian-splat" as const,
    uri: `local://spatial/test/${assetId}.splat`,
    previewUri: `fixture://spatial/test/${assetId}.json`,
    assetFormat: "splat" as const,
    coordinateSystem: "mission-local" as const,
    bounds: { x: 6, y: 6, width: 6, height: 6 },
    sampleCount: 64,
    renderHints: { color: "#50d7b8" },
    sourceAdapter: "test",
    frameId: "map",
    createdAt: now,
    position: { x: 8, y: 8, z: 1 },
    confidence: 0.86,
    transformConfidence: 0.84,
    linkedDetectionIds: [],
    evidenceAssetIds: [],
    metadata: {}
  };
}
