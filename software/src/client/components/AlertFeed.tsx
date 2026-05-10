import { AlertOctagon, Bell, CheckCircle2 } from "lucide-react";
import type { Alert } from "../../shared/types";

export function AlertFeed({ alerts, onAck }: { alerts: Alert[]; onAck: (id: string) => void }) {
  return (
    <section className="rail-panel alerts-panel">
      <div className="panel-title compact">
        <h2>Alerts</h2>
        <span>{alerts.filter((alert) => !alert.acknowledged).length} open</span>
      </div>

      <div className="alert-list">
        {alerts.slice(0, 9).map((alert) => (
          <article key={alert.id} className="alert-item" data-severity={alert.severity} data-ack={alert.acknowledged}>
            <div className="alert-icon">{alert.acknowledged ? <CheckCircle2 size={17} /> : <AlertOctagon size={17} />}</div>
            <div className="alert-copy">
              <div>
                <strong>{alert.title}</strong>
                <span>{alert.severity}</span>
              </div>
              <p>{alert.message}</p>
              <time>{formatTime(alert.createdAt)}</time>
            </div>
            {!alert.acknowledged && (
              <button className="icon-button" onClick={() => onAck(alert.id)} title="Acknowledge alert">
                <Bell size={15} />
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}
