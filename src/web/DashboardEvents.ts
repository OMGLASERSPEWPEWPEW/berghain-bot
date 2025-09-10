// File: src/web/DashboardEvents.ts (relative to project root)
import { EventEmitter } from 'events';
import type { CurrentState, Person, Constraint } from '../core/types';
import type { FeasibilityResult } from '../core/Feasibility';

export interface GameStartedEvent {
  scenario: number;
  constraints: Constraint[];
  gameId: string;
}

export interface StateUpdateEvent extends CurrentState {
  feasibility?: FeasibilityResult;
}

export interface DecisionEvent {
  personIndex: number;
  person: Person;
  accept: boolean;
  reason: string;
  timestamp: number;
}

export interface GameCompletedEvent {
  finalState: CurrentState;
  totalRejections: number;
  success: boolean;
}

/**
 * Singleton event emitter for dashboard communication
 */
class DashboardEventEmitter extends EventEmitter {
  private static instance: DashboardEventEmitter;

  private constructor() {
    super();
    this.setMaxListeners(20); // Allow multiple listeners
  }

  public static getInstance(): DashboardEventEmitter {
    if (!DashboardEventEmitter.instance) {
      DashboardEventEmitter.instance = new DashboardEventEmitter();
    }
    return DashboardEventEmitter.instance;
  }

  // Typed event emitters
  emitGameStarted(data: GameStartedEvent): void {
    const fn = "emitGameStarted";
    console.log("src/web/DashboardEvents.ts:%s - emitting game started for scenario %d", fn, data.scenario);
    this.emit('gameStarted', data);
  }

  emitStateUpdate(data: StateUpdateEvent): void {
    this.emit('stateUpdate', data);
  }

  emitDecision(data: DecisionEvent): void {
    const fn = "emitDecision";
    console.log("src/web/DashboardEvents.ts:%s - emitting decision: %s for person %d", 
      fn, data.accept ? 'ACCEPT' : 'REJECT', data.personIndex);
    this.emit('decision', data);
  }

  emitGameCompleted(data: GameCompletedEvent): void {
    const fn = "emitGameCompleted";
    console.log("src/web/DashboardEvents.ts:%s - emitting game completed with %d rejections", fn, data.totalRejections);
    this.emit('gameCompleted', data);
  }

  // Typed event listeners
  onGameStarted(listener: (data: GameStartedEvent) => void): void {
    this.on('gameStarted', listener);
  }

  onStateUpdate(listener: (data: StateUpdateEvent) => void): void {
    this.on('stateUpdate', listener);
  }

  onDecision(listener: (data: DecisionEvent) => void): void {
    this.on('decision', listener);
  }

  onGameCompleted(listener: (data: GameCompletedEvent) => void): void {
    this.on('gameCompleted', listener);
  }
}

// Export singleton instance
export const dashboardEvents = DashboardEventEmitter.getInstance();

// File length: 2,247 characters