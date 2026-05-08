export interface RunEvent {
  type: string;
  payload: unknown;
}

export class RunRegistry {
  private readonly events = new Map<string, RunEvent[]>();
  private readonly listeners = new Map<string, Set<(event: RunEvent) => void>>();
  private readonly completed = new Set<string>();

  createRun(runId: string): void {
    if (!this.events.has(runId)) {
      this.events.set(runId, []);
    }
  }

  publish(runId: string, event: RunEvent): void {
    this.createRun(runId);
    this.events.get(runId)?.push(event);
    for (const listener of this.listeners.get(runId) ?? []) {
      listener(event);
    }
  }

  complete(runId: string): void {
    this.completed.add(runId);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    this.createRun(runId);
    for (const event of this.events.get(runId) ?? []) {
      listener(event);
    }
    const listeners = this.listeners.get(runId) ?? new Set<(event: RunEvent) => void>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  isComplete(runId: string): boolean {
    return this.completed.has(runId);
  }
}
