// File: src/strategy/Strategy.ts (relative to project root)
import type { CurrentState, Person } from "../core/types";

export interface Strategy {
  shouldAdmitPerson(state: CurrentState, next: Person): boolean;
}
