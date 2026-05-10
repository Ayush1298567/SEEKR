import { Box, Crosshair, MapPin } from "lucide-react";
import type { MissionState } from "../../shared/types";

export interface MapLayers {
  occupancy: boolean;
  frontier: boolean;
  zones: boolean;
  detections: boolean;
  conflicts: boolean;
  staleSources: boolean;
  noFlyZones: boolean;
  spatial: boolean;
}

export function MapView({
  state,
  layers,
  onToggleLayer
}: {
  state: MissionState;
  layers: MapLayers;
  onToggleLayer: (layer: keyof MapLayers) => void;
}) {
  const width = state.map.width;
  const height = state.map.height;

  return (
    <section className="map-panel" aria-label="Mission map">
      <div className="panel-title">
        <div>
          <h2>Mission Map</h2>
          <span>{state.zones.filter((zone) => zone.status === "active").length} active zones</span>
        </div>
        <div className="map-legend" aria-label="Map layers">
          {Object.entries(layerLabels).map(([key, label]) => (
            <button
              key={key}
              className="layer-toggle"
              data-active={layers[key as keyof MapLayers]}
              onClick={() => onToggleLayer(key as keyof MapLayers)}
              title={`${layers[key as keyof MapLayers] ? "Hide" : "Show"} ${label}`}
            >
              <i data-kind={key} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="map-stage">
        <div className="map-grid" style={{ "--map-w": width, "--map-h": height } as React.CSSProperties}>
          {state.map.cells.map((cell) => (
            <div
              key={`${cell.x}-${cell.y}`}
              className="map-cell"
              data-known={layers.occupancy && cell.known}
              data-frontier={layers.frontier && cell.frontier}
              data-occupied={layers.occupancy && cell.occupied && cell.known}
              data-conflict={layers.conflicts && cell.conflict}
              data-stale={layers.staleSources && cell.stale}
              title={cell.lastSeenBy ? `${cell.lastSeenBy}${cell.stale ? " stale" : ""}${cell.conflict ? " conflict" : ""}` : undefined}
              style={{ opacity: layers.occupancy && cell.known ? Math.max(0.42, cell.confidence) : 0.18 }}
            />
          ))}
        </div>

        {layers.zones && state.zones.map((zone) => (
          <div
            key={zone.id}
            className="zone-box"
            data-priority={zone.priority}
            style={{
              left: `${(zone.bounds.x / width) * 100}%`,
              top: `${(zone.bounds.y / height) * 100}%`,
              width: `${(zone.bounds.width / width) * 100}%`,
              height: `${(zone.bounds.height / height) * 100}%`
            }}
          >
            <span>{zone.name}</span>
          </div>
        ))}

        {layers.noFlyZones && state.noFlyZones.map((zone, index) => (
          <div
            key={`${zone.x}-${zone.y}-${index}`}
            className="no-fly-box"
            style={{
              left: `${(zone.x / width) * 100}%`,
              top: `${(zone.y / height) * 100}%`,
              width: `${(zone.width / width) * 100}%`,
              height: `${(zone.height / height) * 100}%`
            }}
          />
        ))}

        {layers.detections && state.detections.map((detection) => (
          <div
            key={detection.id}
            className="detection-marker"
            data-severity={detection.severity}
            style={{
              left: `${(detection.position.x / width) * 100}%`,
              top: `${(detection.position.y / height) * 100}%`
            }}
            title={`${detection.kind} ${detection.confidence}%`}
          >
            <Crosshair size={16} />
          </div>
        ))}

        {layers.spatial && state.spatialAssets.map((asset) => (
          <div
            key={asset.assetId}
            className="spatial-marker"
            data-kind={asset.kind}
            style={{
              left: `${(asset.position.x / width) * 100}%`,
              top: `${(asset.position.y / height) * 100}%`
            }}
            title={`${asset.kind} ${Math.round(asset.confidence * 100)}% transform ${Math.round(asset.transformConfidence * 100)}%`}
          >
            {asset.kind === "vps-pose" ? <Crosshair size={14} /> : <Box size={14} />}
          </div>
        ))}

        {state.drones.map((drone) => (
          <div
            key={drone.id}
            className="drone-marker"
            data-status={drone.status}
            style={{
              left: `${(drone.position.x / width) * 100}%`,
              top: `${(drone.position.y / height) * 100}%`
            }}
            title={`${drone.name} ${drone.status}`}
          >
            <MapPin size={18} />
            <span>{drone.name.replace("SEEKR ", "")}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const layerLabels: Record<keyof MapLayers, string> = {
  occupancy: "Occupancy",
  frontier: "Frontier",
  zones: "Zones",
  detections: "Detections",
  conflicts: "Conflicts",
  staleSources: "Stale",
  noFlyZones: "No-fly",
  spatial: "Spatial"
};
