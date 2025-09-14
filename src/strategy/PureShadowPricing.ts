// File: src/strategy/PureShadowPricing.ts (relative to project root)
import type { CurrentState, Person } from "../core/types";
import type { Strategy, StrategyDecision } from "./Strategy";
import { DualTracker } from "./ShadowPricingUtils/DualTracker";
import { calculateAllSlacks } from "./ShadowPricingUtils/SlackCalculator";
import { scorePerson } from "./ShadowPricingUtils/PersonScorer";
import { computeDeficits, allMinimaMet, evaluateDecisionFeasibility, evaluateDecisionFeasibilityByLine, evaluateFeasibilityScore, FILLER_MIN_SLACK } from "../core/Feasibility";


/**
 * Pure shadow pricing strategy without feasibility checks
 * 
 * Core principle: Accept person if value(p) = Σλ_c - seat_cost > threshold
 * 
 * No bottleneck analysis, no feasibility projections - just pure dual optimization.
 * Shadow prices λ_c learn constraint importance automatically.
 */
export class PureShadowPricing implements Strategy {
  private dualTracker: DualTracker;
  private isInitialized: boolean = false;
  private lastDualUpdate: number = 0;
  
  // Hyperparameters for pure shadow pricing
  private static readonly DUAL_UPDATE_FREQUENCY = 10;    // Update λ every N people
  private static readonly LEARNING_RATE = 0.25;          // η for dual updates (slightly higher)
  private static readonly HELPER_THRESHOLD = 5.0;        // Min value for helpers
  private static readonly FILLER_THRESHOLD = -2.0;       // Min value for non-helpers (more permissive)
  private static readonly SAFE_FILLER_THRESHOLD = 2.0;   // When all constraints met, be conservative

  constructor() {
    this.dualTracker = new DualTracker(PureShadowPricing.LEARNING_RATE);
    console.log("src/strategy/PureShadowPricing.ts:constructor - initialized pure shadow pricing strategy");
  }

shouldAdmitPerson(state: CurrentState, next: Person): StrategyDecision {
  const fn = "shouldAdmitPerson";

  // Initialize duals on first call
  if (!this.isInitialized) {
    this.dualTracker.initDuals(state.constraints, state.statistics);
    this.isInitialized = true;
    console.log("src/strategy/PureShadowPricing.ts:%s - initialized duals for %d constraints", fn, state.constraints.length);
  }

  // Periodic dual updates
  const peopleProcessed = state.admittedCount + state.rejectedCount;
  if (peopleProcessed - this.lastDualUpdate >= PureShadowPricing.DUAL_UPDATE_FREQUENCY) {
    this.updateDualVariables(state);
    this.lastDualUpdate = peopleProcessed;
  }

  // Get shadow price info for logging
  const score = scorePerson(next, this.dualTracker, state);
  const deficits = computeDeficits(state);
  const helpsUnmetConstraint = this.helpsUnmetConstraints(next, deficits);

  // Marginal feasibility scoring
  const scoreIfReject = evaluateFeasibilityScore(state, state.statistics, null, false);
  const scoreIfAccept = evaluateFeasibilityScore(state, state.statistics, next, true);

  // Base marginal value
  let marginalValue = scoreIfAccept - scoreIfReject;

  // STRONGER opportunity cost penalty
  const slacks = calculateAllSlacks(state).slacks;

  
  // Additional penalty based on how many seats remain
  const seatsRemaining = 1000 - state.admittedCount;
  const scarcityMultiplier = Math.max(1.0, 500 / Math.max(1, seatsRemaining));
  


  
  let threshold = 0.0;
  

  

  console.log("src/strategy/PureShadowPricing.ts:%s - marginalValue", marginalValue);
  console.log("src/strategy/PureShadowPricing.ts:%s - threshold", threshold);
  const accept = marginalValue > threshold;
  
  console.log(
    "src/strategy/PureShadowPricing.ts:%s - %s %s (marginal=%.3f, helps=%d, hurts=%d, threshold=%.1f, Σλ=%.3f)",
    fn,
    accept ? "ACCEPT" : "REJECT",
    helpsUnmetConstraint ? "helper" : "filler",
    marginalValue,
    threshold,
    score.shadowPriceSum
  );

  return {
    accept,
    scoring: {
      shadowPriceSum: score.shadowPriceSum,
      seatCost: score.seatCost,
      totalValue: score.totalValue,
      helpedAttributes: score.helpedAttributes
    }
  };
}

  
  /**
   * Check if person helps any constraint that still has unmet demand
   */
  private helpsUnmetConstraints(person: Person, deficits: Record<string, number>): boolean {
    for (const [attr, need] of Object.entries(deficits)) {
      if (need > 0 && person.attributes[attr]) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Update dual variables using current performance
   * Mathematical: λ_c^(t+1) = max(0, λ_c^(t) + η * slack_c^(t))
   */
  private updateDualVariables(state: CurrentState): void {
    const fn = "updateDualVariables";
    
    const { slacks, details } = calculateAllSlacks(state);
    
    console.log("src/strategy/PureShadowPricing.ts:%s - updating duals with slacks: %s", 
      fn, JSON.stringify(slacks));
    
    this.dualTracker.updateDuals(slacks);
    
    // Log current dual values and their ranking
    const duals = this.dualTracker.getAllDuals();
    const rankedDuals = Object.entries(duals)
      .sort(([,a], [,b]) => b - a)  // Sort by value descending
      .map(([attr, lambda]) => `${attr}:${lambda.toFixed(2)}`)
      .join(', ');
    
    console.log("src/strategy/PureShadowPricing.ts:%s - dual ranking: %s", fn, rankedDuals);
    
    // Log tightest constraints (negative slack = behind target)
    const tightConstraints = details
      .filter(d => d.slack < 0)
      .sort((a, b) => a.slack - b.slack)  // Most negative first
      .map(d => `${d.attribute}:${d.slack.toFixed(1)}`)
      .join(', ');
    
    if (tightConstraints) {
      console.log("src/strategy/PureShadowPricing.ts:%s - tight constraints (slack<0): %s", fn, tightConstraints);
    }
  }
}

// File length: 4,487 characters