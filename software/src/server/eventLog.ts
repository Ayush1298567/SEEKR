import type { AuditEvent } from "../shared/types";

const MAX_EVENTS = 500;

export class EventLog {
  private events: AuditEvent[] = [];
  private listeners: Array<(event: AuditEvent) => void> = [];

  add(actor: AuditEvent["actor"], type: string, message: string, data?: Record<string, unknown>) {
    const event: AuditEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      actor,
      type,
      message,
      createdAt: Date.now(),
      data
    };

    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.length = MAX_EVENTS;
    }
    this.listeners.forEach((listener) => listener(event));
    return event;
  }

  onEvent(listener: (event: AuditEvent) => void) {
    this.listeners.push(listener);
  }

  tail(limit = 50) {
    return this.events.slice(0, limit);
  }

  all() {
    return [...this.events];
  }
}
