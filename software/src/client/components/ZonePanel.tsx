import { CornerDownRight, MapPinned } from "lucide-react";
import type { AiProposal, Drone, SearchZone, TaskLedgerEntry } from "../../shared/types";

export function ZonePanel({
  drones,
  zones,
  taskLedger,
  proposals,
  onAssign
}: {
  drones: Drone[];
  zones: SearchZone[];
  taskLedger: TaskLedgerEntry[];
  proposals: AiProposal[];
  onAssign: (droneId: string, zoneId: string) => void;
}) {
  const latestProposal = proposals.find((proposal) => proposal.plan.kind === "assign-zone" && proposal.status !== "executed");

  return (
    <section className="data-panel zone-panel">
      <div className="panel-title compact">
        <h2>Zones</h2>
        <span>{zones.filter((zone) => zone.status !== "complete").length} open</span>
      </div>

      <div className="zone-list">
        {zones.map((zone) => (
          <article key={zone.id} className="zone-row" data-priority={zone.priority}>
            <div className="zone-heading">
              <MapPinned size={16} />
              <strong>{zone.name}</strong>
              <span>{zone.priority}</span>
            </div>
            <div className="zone-progress">
              <i style={{ width: `${zone.coverage}%` }} />
            </div>
            <div className="zone-meta">
              <span>{zone.coverage}% coverage</span>
              <span>{zone.status}</span>
            </div>
            <div className="task-strip">
              <span>{taskLedger.find((task) => task.zoneId === zone.id)?.status ?? "no task"}</span>
              {latestProposal?.plan.zoneId === zone.id && <span>proposed {latestProposal.plan.droneId}</span>}
            </div>
            <div className="assign-row">
              <select
                value={zone.assignedDroneIds[0] ?? ""}
                onChange={(event) => event.target.value && onAssign(event.target.value, zone.id)}
                aria-label={`Assign drone to ${zone.name}`}
              >
                <option value="">Unassigned</option>
                {drones.map((drone) => (
                  <option key={drone.id} value={drone.id}>
                    {drone.name}
                  </option>
                ))}
              </select>
              <CornerDownRight size={15} />
            </div>
          </article>
        ))}
        <article className="zone-row task-ledger">
          <div className="zone-heading">
            <MapPinned size={16} />
            <strong>Task Ledger</strong>
            <span>{taskLedger.length}</span>
          </div>
          <div className="task-list">
            {taskLedger.slice(0, 5).map((task) => (
              <div key={task.taskId}>
                <strong>{task.zoneId}</strong>
                <span>{task.droneId} / {task.status}</span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
