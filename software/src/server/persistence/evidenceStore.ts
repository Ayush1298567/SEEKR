import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { EvidenceAsset } from "../../shared/types";

export class EvidenceStore {
  private assets: EvidenceAsset[] = [];

  constructor(private readonly root = process.env.SEEKR_DATA_DIR ?? path.join(process.cwd(), "data", "evidence")) {}

  async init() {
    await mkdir(this.root, { recursive: true });
  }

  add(asset: EvidenceAsset) {
    if (!this.assets.some((candidate) => candidate.assetId === asset.assetId)) this.assets.unshift(asset);
  }

  all() {
    return [...this.assets];
  }

  get(assetId: string) {
    return this.assets.find((asset) => asset.assetId === assetId);
  }
}
