// File: src/strategy/Strategy.ts (relative to project root)
import type { CurrentState, Person } from "../core/types";

export interface Strategy {
  shouldAdmitPerson(state: CurrentState, next: Person): StrategyDecision;
}

export interface StrategyDecision {
  accept: boolean;
  scoring?: {
    shadowPriceSum: number;
    seatCost: number;
    totalValue: number;
    helpedAttributes: string[];
  };
}