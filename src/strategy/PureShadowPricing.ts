// File: src/strategy/PureShadowPricing.ts (relative to project root)
import type { CurrentState, Person } from "../core/types";
import type { Strategy } from "./Strategy";
import { DualTracker } from "./DualTracker";
import { calculateAllSlacks } from "./SlackCalculator";
import { scorePerson } from "./PersonScorer";
import { computeDeficits, allMinimaMet } from "../core/Feasibility";


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
  private static readonly LEARNING_RATE = 0.15;          // η for dual updates (slightly higher)
  private static readonly HELPER_THRESHOLD = 0.0;        // Min value for helpers
  private static readonly FILLER_THRESHOLD = -0.5;       // Min value for non-helpers (more permissive)
  private static readonly SAFE_FILLER_THRESHOLD = 0.8;   // When all constraints met, be conservative

  constructor() {
    this.dualTracker = new DualTracker(PureShadowPricing.LEARNING_RATE);
    console.log("src/strategy/PureShadowPricing.ts:constructor - initialized pure shadow pricing strategy");
  }

  shouldAdmitPerson(state: CurrentState, next: Person): boolean {
    const fn = "shouldAdmitPerson";
    
    // Initialize duals on first call
    if (!this.isInitialized) {
      this.dualTracker.initDuals(state.constraints);  // λ_c^(0) = 0 ∀c
      this.isInitialized = true;
      console.log("src/strategy/PureShadowPricing.ts:%s - initialized duals for %d constraints", 
        fn, state.constraints.length);
    }
    
    // Update dual variables periodically
    const peopleProcessed = state.admittedCount + state.rejectedCount;
    if (peopleProcessed - this.lastDualUpdate >= PureShadowPricing.DUAL_UPDATE_FREQUENCY) {
      this.updateDualVariables(state);
      this.lastDualUpdate = peopleProcessed;
    }
    
    // Score person using shadow prices: value(p) = Σλ_c - seat_cost_risk
    const score = scorePerson(next, this.dualTracker, state);
    
    // Check if person helps any unmet constraint
    const deficits = computeDeficits(state);
    const helpsUnmetConstraint = this.helpsUnmetConstraints(next, deficits);
    
    // Special case: if all constraints are satisfied, be more conservative
    if (allMinimaMet(deficits)) {
      const accept = score.totalValue >= PureShadowPricing.SAFE_FILLER_THRESHOLD;
      console.log("src/strategy/PureShadowPricing.ts:%s - %s safe filler (all constraints met, score=%f≥%f)", 
        fn, accept ? "ACCEPT" : "REJECT", score.totalValue, PureShadowPricing.SAFE_FILLER_THRESHOLD);
      return accept;
    }
    
    // Pure shadow pricing decision
    let threshold: number;
    let personType: string;
    
    if (helpsUnmetConstraint) {
      threshold = PureShadowPricing.HELPER_THRESHOLD;
      personType = "helper";
    } else {
      threshold = PureShadowPricing.FILLER_THRESHOLD;
      personType = "filler";
    }
    
    const accept = score.totalValue >= threshold;
    
    console.log("src/strategy/PureShadowPricing.ts:%s - %s %s (score=%f %s %f, Σλ=%f, cost=%f, helps: %s)", 
      fn, 
      accept ? "ACCEPT" : "REJECT",
      personType,
      score.totalValue,
      accept ? "≥" : "<",
      threshold,
      score.shadowPriceSum,
      score.seatCost,
      score.helpedAttributes.join(',') || 'none'
    );
    
    return accept;
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