// File: src/strategy/PacedFeasibleWithDuals.ts (relative to project root)
import type { CurrentState, Person } from "../core/types";
import type { Strategy } from "./Strategy";
import {
  allMinimaMet,
  computeDeficits,
  evaluateDecisionFeasibility,
  FILLER_MIN_SLACK,
} from "../core/Feasibility";
import { DualTracker } from "./DualTracker";
import { calculateAllSlacks } from "./SlackCalculator";
import { scorePerson } from "./PersonScorer";

/**
 * Enhanced PacedFeasible with primal-dual optimization
 * 
 * Combines:
 * - Shadow prices (λ_c) that learn constraint importance
 * - Person scoring based on dual values
 * - Original PacedFeasible feasibility logic (proven successful)
 */
export class PacedFeasibleWithDuals implements Strategy {
  private dualTracker: DualTracker;
  private isInitialized: boolean = false;
  private lastDualUpdate: number = 0;
  
  // Hyperparameters
  private static readonly DUAL_UPDATE_FREQUENCY = 25;  // Update λ every N people
  private static readonly LEARNING_RATE = 0.1;         // η for dual updates
  private static readonly VALUE_THRESHOLD = 0.5;       // Min value(p) to consider
  private static readonly HELPER_EPS = 0.0;            // PacedFeasible compatibility
  private static readonly FILLER_MARGIN = 0.3;         // PacedFeasible compatibility

  constructor() {
    this.dualTracker = new DualTracker(PacedFeasibleWithDuals.LEARNING_RATE);
    console.log("src/strategy/PacedFeasibleWithDuals.ts:constructor - initialized dual-enhanced strategy");
  }

  shouldAdmitPerson(state: CurrentState, next: Person): boolean {
    const fn = "shouldAdmitPerson";
    
    // Initialize duals on first call
    if (!this.isInitialized) {
      this.dualTracker.initDuals(state.constraints);  // λ_c^(0) = 0 ∀c
      this.isInitialized = true;
      console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - initialized duals for %d constraints", 
        fn, state.constraints.length);
    }
    
    // Update dual variables periodically
    const peopleProcessed = state.admittedCount + state.rejectedCount;
    if (peopleProcessed - this.lastDualUpdate >= PacedFeasibleWithDuals.DUAL_UPDATE_FREQUENCY) {
      this.updateDualVariables(state);
      this.lastDualUpdate = peopleProcessed;
    }
    
    const deficits = computeDeficits(state);
    
    // If all minima satisfied → accept everyone (safe filler)
    if (allMinimaMet(deficits)) {
      console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - ACCEPT filler (all minima satisfied)", fn);
      return true;
    }
    
    // Score person using shadow prices: value(p) = Σλ_c - seat_cost_risk
    const score = scorePerson(next, this.dualTracker, state);
    
    // Check if person helps any unmet constraint
    const helpsAttrs: string[] = [];
    for (const [attr, need] of Object.entries(deficits)) {
      if (need > 0 && next.attributes[attr]) helpsAttrs.push(attr);
    }
    const helps = helpsAttrs.length > 0;
    
    // Evaluate feasibility for both choices (from original PacedFeasible)
    const evalReject = evaluateDecisionFeasibility(state, state.statistics, null, false);
    const evalAccept = evaluateDecisionFeasibility(state, state.statistics, next, true);
    
    const deltaSlack = evalAccept.minSlack - evalReject.minSlack;
    
    // Count unmet constraints for endgame logic
    const unmetConstraintsCount = Object.values(deficits).filter(v => v > 0).length;

    if (helps) {
      // Helper logic: combine dual scoring with proven endgame feasibility analysis
      
      // Hard feasibility constraints (from PacedFeasible)
      if (evalReject.feasible && !evalAccept.feasible) {
        console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - REJECT helper (breaks feasibility, score=%f)", 
          fn, score.totalValue);
        return false;
      }
      if (!evalReject.feasible && evalAccept.feasible) {
        console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - ACCEPT helper (restores feasibility, score=%f)", 
          fn, score.totalValue);
        return true;
      }
      
      // Both feasible OR both infeasible: apply proven endgame logic
      if (unmetConstraintsCount === 1) {
        // --- END-GAME LOGIC (1 Constraint Left) --- 
        // Use trueDeltaSlack for the specific bottleneck constraint
        const originalBottleneckAttr = evalReject.minSlackAttr;
        let trueDeltaSlackForBottleneck: number;

        if (originalBottleneckAttr && evalAccept.perAttr[originalBottleneckAttr]) {
          const newSlackForOldBottleneck = evalAccept.perAttr[originalBottleneckAttr].slack;
          trueDeltaSlackForBottleneck = newSlackForOldBottleneck - evalReject.minSlack;
        } else {
          trueDeltaSlackForBottleneck = evalAccept.minSlack - evalReject.minSlack; // Fallback
        }

        if (trueDeltaSlackForBottleneck >= PacedFeasibleWithDuals.HELPER_EPS) {
          console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - ACCEPT helper (End-game: true Δslack=%.2f, score=%f)", 
            fn, trueDeltaSlackForBottleneck, score.totalValue);
          return true;
        } else {
          console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - REJECT helper (End-game: true Δslack=%.2f, score=%f)", 
            fn, trueDeltaSlackForBottleneck, score.totalValue);
          return false;
        }
      } else if (unmetConstraintsCount <= 2) {
        // --- AGGRESSIVE LOGIC (≤2 Constraints Left) ---
        // Prefer taking helpers to avoid 20k-reject stall
        if (evalAccept.feasible) {
          console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - ACCEPT helper (≤2 constraints, feasible, score=%f)", 
            fn, score.totalValue);
          return true;
        } else {
          // Both infeasible: still prefer helper to reduce deficit
          console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - ACCEPT helper (≤2 constraints, both infeasible, score=%f)", 
            fn, score.totalValue);
          return true;
        }
      } else {
        // --- STANDARD LOGIC (>2 Constraints Left) ---
        // Use dual scoring + feasibility for early/mid game
        const dualScorePositive = score.totalValue >= PacedFeasibleWithDuals.VALUE_THRESHOLD;
        const feasibilityOK = deltaSlack >= PacedFeasibleWithDuals.HELPER_EPS;
        
        if (dualScorePositive && feasibilityOK) {
          console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - ACCEPT helper (score=%f≥%f, Δslack=%f≥%f)", 
            fn, score.totalValue, PacedFeasibleWithDuals.VALUE_THRESHOLD, deltaSlack, PacedFeasibleWithDuals.HELPER_EPS);
          return true;
        } else {
          console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - REJECT helper (score=%f, Δslack=%f)", 
            fn, score.totalValue, deltaSlack);
          return false;
        }
      }
    } else {
      // Filler logic: enhanced with dual scoring
      const fillerThreshold = Math.max(FILLER_MIN_SLACK, evalReject.minSlack + PacedFeasibleWithDuals.FILLER_MARGIN);
      const feasibilityOK = evalAccept.feasible && evalAccept.minSlack >= fillerThreshold;
      const dualScorePositive = score.totalValue >= 0.0;  // Lower bar for filler
      
      if (feasibilityOK && dualScorePositive) {
        console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - ACCEPT filler (score=%f≥0, slack=%f≥%f)", 
          fn, score.totalValue, evalAccept.minSlack, fillerThreshold);
        return true;
      } else {
        console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - REJECT filler (score=%f, slack=%f)", 
          fn, score.totalValue, evalAccept.minSlack);
        return false;
      }
    }
  }
  
  /**
   * Update dual variables using current performance
   * Mathematical: λ_c^(t+1) = max(0, λ_c^(t) + η * slack_c^(t))
   */
  private updateDualVariables(state: CurrentState): void {
    const fn = "updateDualVariables";
    
    const { slacks, details } = calculateAllSlacks(state);
    
    console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - updating duals with slacks: %s", 
      fn, JSON.stringify(slacks));
    
    this.dualTracker.updateDuals(slacks);
    
    // Log current dual values for debugging
    const duals = this.dualTracker.getAllDuals();
    console.log("src/strategy/PacedFeasibleWithDuals.ts:%s - new dual values: %s", 
      fn, JSON.stringify(duals));
  }
}

// File length: 4,987 characters