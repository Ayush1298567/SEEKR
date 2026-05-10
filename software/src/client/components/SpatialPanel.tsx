import { Box, Crosshair, ScanSearch } from "lucide-react";
import type { SpatialAsset } from "../../shared/types";

export function SpatialPanel({
  assets,
  onOpen,
  onImport
}: {
  assets: SpatialAsset[];
  onOpen: (asset: SpatialAsset) => void;
  onImport: () => void;
}) {
  const aligned = assets.filter((asset) => asset.status === "aligned").length;

  return (
    <section className="data-panel spatial-panel">
      <div className="panel-title compact">
        <h2>Spatial</h2>
        <span>{aligned}/{assets.length} aligned</span>
        <button onClick={onImport} title="Import spatial manifest">
          <ScanSearch size={15} /> Import
        </button>
      </div>

      {assets.length ? (
        <div className="spatial-list">
          {assets.slice(0, 6).map((asset) => (
            <article key={asset.assetId} className="spatial-row" data-kind={asset.kind}>
              <div className="spatial-heading">
                {asset.kind === "vps-pose" ? <Crosshair size={16} /> : <Box size={16} />}
                <strong>{formatKind(asset.kind)}</strong>
                <span>{asset.status}</span>
              </div>
              <div className="spatial-metrics">
                <span>conf {Math.round(asset.confidence * 100)}%</span>
                <span>xfm {Math.round(asset.transformConfidence * 100)}%</span>
                <span>{asset.droneId ?? "scene"}</span>
              </div>
              <p>{asset.frameId}</p>
              <div className="evidence-line">
                <span>{asset.sourceAdapter}</span>
                {asset.linkedDetectionIds.map((id) => <span key={id}>{id}</span>)}
              </div>
              <button className="spatial-open" onClick={() => onOpen(asset)} title="Open in 3D viewer">
                <ScanSearch size={15} /> View
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <ScanSearch size={22} />
          <span>No spatial assets</span>
        </div>
      )}
    </section>
  );
}

function formatKind(kind: SpatialAsset["kind"]) {
  return kind
    .split("-")
    .map((part) => part.toUpperCase() === "VPS" ? "VPS" : part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
