import { Home, Pause, Play, RadioTower, RotateCcw, TriangleAlert } from "lucide-react";
import type { Drone, DroneAction, SearchZone } from "../../shared/types";

export function DronePanel({
  drones,
  zones,
  onAction
}: {
  drones: Drone[];
  zones: SearchZone[];
  onAction: (droneId: string, action: DroneAction) => void;
}) {
  return (
    <section className="data-panel drone-panel">
      <div className="panel-title compact">
        <h2>Drone Telemetry</h2>
        <span>{drones.length} aircraft</span>
      </div>
      <div className="drone-table">
        {drones.map((drone) => {
          const zone = zones.find((candidate) => candidate.id === drone.assignedZoneId);
          return (
            <article key={drone.id} className="drone-row" data-status={drone.status}>
              <div className="drone-heading">
                <strong>{drone.name}</strong>
                <span>{drone.status}</span>
              </div>
              <div className="bars">
                <Bar label="Batt" value={drone.batteryPct} warn={drone.batteryPct <= drone.dynamicReservePct + 8} />
                <Bar label="Link" value={drone.linkQuality} warn={drone.linkQuality < 55} />
                <Bar label="VIO" value={drone.estimatorQuality} warn={drone.estimatorQuality < 65} />
              </div>
              <p>{zone?.name ?? "Unassigned"} · {drone.currentTask}</p>
              <div className="row-actions">
                <button onClick={() => onAction(drone.id, "resume")} title="Resume">
                  <Play size={14} /> Resume
                </button>
                <button onClick={() => onAction(drone.id, "hold")} title="Hold">
                  <Pause size={14} /> Hold
                </button>
                <button onClick={() => onAction(drone.id, "return-home")} title="Return home">
                  <Home size={14} /> RTH
                </button>
                <button onClick={() => onAction(drone.id, "simulate-link-loss")} title="Simulate link loss">
                  <RadioTower size={14} /> Link
                </button>
                <button onClick={() => onAction(drone.id, "simulate-failure")} title="Simulate failure">
                  <TriangleAlert size={14} /> Fail
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Bar({ label, value, warn }: { label: string; value: number; warn: boolean }) {
  return (
    <div className="bar-line" data-warn={warn}>
      <span>{label}</span>
      <div>
        <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <strong>{Math.round(value)}</strong>
    </div>
  );
}
