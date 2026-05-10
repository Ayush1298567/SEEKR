import { describe, expect, it } from "vitest";
import type { MapDelta } from "../../shared/types";
import { MissionStore } from "../state";

const now = 1_800_000_000_000;

describe("map fusion", () => {
  it("preserves known state and marks high-confidence contradictions as conflicts", () => {
    const store = new MissionStore({ clock: () => now });
    store.ingestMapDelta(delta([{ x: 0, y: 10, occupancy: "occupied", probability: 0.92, confidence: 0.9 }]));

    const cell = store.snapshot().map.cells.find((candidate) => candidate.x === 0 && candidate.y === 10);
    expect(cell?.conflict).toBe(true);
    expect(cell?.occupancy).toBe("conflict");
    expect(cell?.occupied).toBe(false);
  });

  it("creates a P2 alert for large conflict sets", () => {
    const store = new MissionStore({ clock: () => now });
    store.ingestMapDelta(
      delta([
        { x: 0, y: 10, occupancy: "occupied", probability: 0.92, confidence: 0.9 },
        { x: 1, y: 10, occupancy: "occupied", probability: 0.92, confidence: 0.9 },
        { x: 2, y: 10, occupancy: "occupied", probability: 0.92, confidence: 0.9 },
        { x: 3, y: 10, occupancy: "occupied", probability: 0.92, confidence: 0.9 }
      ])
    );

    expect(store.snapshot().alerts[0]).toMatchObject({ severity: "P2", title: "Map source conflict" });
  });

  it("ages stale sources but rejects stale, low-transform, oversized, and out-of-bounds deltas before state mutation", () => {
    const store = new MissionStore({ clock: () => now });
    store.ingestMapDelta(delta([{ x: 4, y: 10, occupancy: "free", probability: 0.1, confidence: 0.8 }], { createdAt: now - 40_000 }));
    store.start();
    expect(store.snapshot().map.cells.find((cell) => cell.x === 4 && cell.y === 10)?.stale).toBe(true);

    expect(() => store.ingestMapDelta(delta([{ x: 5, y: 10, occupancy: "free", probability: 0.1, confidence: 0.8 }], { createdAt: now - 130_000 }))).toThrow(/stale/);
    expect(() => store.ingestMapDelta(delta([{ x: 5, y: 10, occupancy: "free", probability: 0.1, confidence: 0.8 }], { transformConfidence: 0.2 }))).toThrow(/Transform confidence/);
    expect(() => store.ingestMapDelta(delta([{ x: 999, y: 999, occupancy: "free", probability: 0.1, confidence: 0.8 }]))).toThrow(/outside map bounds/);
    expect(() =>
      store.ingestMapDelta(
        delta(
          Array.from({ length: 2501 }, (_unused, index) => ({
            x: index % store.snapshot().map.width,
            y: Math.floor(index / store.snapshot().map.width) % store.snapshot().map.height,
            occupancy: "free" as const,
            probability: 0.1,
            confidence: 0.8
          }))
        )
      )
    ).toThrow(/max/);
  });

  it("keeps detections separate from permanent obstacles", () => {
    const store = new MissionStore({ clock: () => now });
    store.ingestDetection({
      id: "det-test",
      droneId: "drone-1",
      kind: "person",
      position: { x: 6, y: 6, z: 2 },
      confidence: 92,
      severity: "P1",
      review: "new",
      createdAt: now,
      updatedAt: now,
      sourceAdapter: "test",
      immutable: true,
      evidenceAssetIds: [],
      evidence: { frameId: "frame-test", thumbnailTone: "red", notes: "test" }
    });

    expect(store.snapshot().detections).toHaveLength(1);
    expect(store.snapshot().map.cells.find((cell) => cell.x === 6 && cell.y === 6)?.occupied).toBe(false);
  });
});

function delta(cells: MapDelta["cells"], overrides: Partial<MapDelta> = {}): MapDelta {
  return {
    deltaId: `delta-${Math.random()}`,
    sourceDroneId: "mapper-1",
    sourceAdapter: "test",
    frameId: "map",
    transformConfidence: 0.9,
    createdAt: now,
    cells,
    metadata: {},
    ...overrides
  };
}
