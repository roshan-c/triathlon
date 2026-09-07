/**
 * In-process pub/sub for project-scoped Server-Sent Events.
 *
 * Commands publish after their transaction commits; the SSE route replays
 * committed activity from the database before subscribing, so a subscriber
 * never misses events between reads.
 */

import { EventEmitter } from "node:events";
import type { Json } from "./context.js";

export interface ProjectEvent {
  /** Monotonic per-project sequence (the resume cursor). */
  sequence: number;
  /** Unique event identifier (UUIDv7). */
  eventId: string;
  eventType: string;
  schemaVersion: 1;
  projectId: string;
  timestamp: string;
  actor: {
    userId: string;
    displayName: string;
    automationId?: string;
  };
  resource: {
    type: string;
    id: string;
  } | null;
  data: Json;
}

type Listener = (event: ProjectEvent) => void;

export class ProjectEventBus {
  private readonly emitter = new EventEmitter();

  publish(projectId: string, event: ProjectEvent): void {
    this.emitter.emit(projectId, event);
  }

  subscribe(projectId: string, listener: Listener): () => void {
    this.emitter.on(projectId, listener);
    return () => this.emitter.off(projectId, listener);
  }
}