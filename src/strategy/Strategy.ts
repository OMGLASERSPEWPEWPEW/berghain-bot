// File: src/strategy/Strategy.ts (relative to project root)
import type { CurrentState, Person } from "../core/types";

export interface Strategy {
  shouldAdmitPerson(state: CurrentState, next: Person): StrategyDecision;
}

export interface StrategyDecision {
  accept: boolean;
  scoring?: {
    // Dual-based strategy fields (for PureShadowPricing)
    shadowPriceSum?: number;
    seatCost?: number;
    totalValue?: number;
    helpedAttributes?: string[];
    
    // Primal-based strategy fields (for PrimalStrategy)
    admissionProbability?: number;
    lpOptimalValue?: number;
    activeConstraints?: string[];
    feasible?: boolean;
    constraintSlacks?: Record<string, number>;
  };
}