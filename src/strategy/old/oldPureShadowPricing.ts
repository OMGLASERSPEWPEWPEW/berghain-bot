// File: src/strategy/PureShadowPricing.ts (relative to project root)
import type { CurrentState, Person } from "../../core/types";
import type { Strategy, StrategyDecision } from "../Strategy";
import { DualTracker } from "../ShadowPricingUtils/DualTracker";
import { calculateAllSlacks } from "../ShadowPricingUtils/SlackCalculator";
import { scorePerson } from "../ShadowPricingUtils/PersonScorer";
import { computeDeficits, allMinimaMet, evaluateDecisionFeasibility, evaluateDecisionFeasibilityByLine, FILLER_MIN_SLACK } from "../../core/Feasibility";


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
  private static readonly DUAL_UPDATE_FREQUENCY = 5;    // Update λ every N people
  private static readonly LEARNING_RATE = 0.3;          // η for dual updates (slightly higher)
  private static readonly HELPER_THRESHOLD = 5.0;        // Min value for helpers
  private static readonly FILLER_THRESHOLD = -2.0;       // Min value for non-helpers (more permissive)
  private static readonly SAFE_FILLER_THRESHOLD = 2.0;   // When all constraints met, be conservative

  constructor() {
    this.dualTracker = new DualTracker(PureShadowPricing.LEARNING_RATE);
    console.log("src/strategy/PureShadowPricing.ts:constructor - initialized pure shadow pricing strategy");
  }

  // File: src/strategy/PureShadowPricing.ts (relative to project root)
shouldAdmitPerson(state: CurrentState, next: Person): StrategyDecision {
  const fn = "shouldAdmitPerson";

  // Initialize duals on first call
  if (!this.isInitialized) {
    this.dualTracker.initDuals(state.constraints, state.statistics);  // λ_c^(0) = 0 ∀c
    this.isInitialized = true;
    console.log("src/strategy/PureShadowPricing.ts:%s - initialized duals for %d constraints", fn, state.constraints.length);
  }

  // Periodic dual updates (unchanged)
  const peopleProcessed = state.admittedCount + state.rejectedCount;
  if (peopleProcessed - this.lastDualUpdate >= PureShadowPricing.DUAL_UPDATE_FREQUENCY) {
    this.updateDualVariables(state);
    this.lastDualUpdate = peopleProcessed;
  }

  // ===== NEW: compare feasibility of REJECT vs ACCEPT hypotheticals =====
  const evalReject = evaluateDecisionFeasibilityByLine(state, state.statistics, null, false /* reject -> do not consume seat */);
  const evalAccept = evaluateDecisionFeasibilityByLine(state, state.statistics, next,  true  /* accept -> consume seat & apply person */);
  const deltaSlack = evalAccept.minSlack - evalReject.minSlack;
  const bottleA = evalAccept.minSlackAttr ?? "n/a";
  const bottleR = evalReject.minSlackAttr ?? "n/a";

  // Hard guard #1: accepting would break feasibility -> reject outright.
  if (evalReject.feasible && !evalAccept.feasible) {
    console.log(
      "src/strategy/PureShadowPricing.ts:%s - REJECT (accept would break feasibility; reject bottleneck=%s slack=%.2f, accept bottleneck=%s slack=%.2f, Δslack=%.2f)",
      fn, bottleR, evalReject.minSlack, bottleA, evalAccept.minSlack, deltaSlack
    );
    return { accept: false };
  }

  // Hard guard #2: accepting restores feasibility while rejecting does not -> accept.
  if (!evalReject.feasible && evalAccept.feasible) {
    console.log(
      "src/strategy/PureShadowPricing.ts:%s - ACCEPT (accept restores feasibility; accept bottleneck=%s slack=%.2f, reject bottleneck=%s slack=%.2f, Δslack=%.2f)",
      fn, bottleA, evalAccept.minSlack, bottleR, evalReject.minSlack, deltaSlack
    );
    return { accept: true };
  }

  // Score via shadow prices: value(p) = Σλ_c - seat_cost_risk
  const score = scorePerson(next, this.dualTracker, state);

  // Helper detection against *current* unmet constraints
  const deficits = computeDeficits(state);
  const helpsUnmetConstraint = this.helpsUnmetConstraints(next, deficits);

  // If all minima are already satisfied, be conservative with filler
  if (allMinimaMet(deficits)) {
    const accept = score.totalValue >= PureShadowPricing.SAFE_FILLER_THRESHOLD;

    console.log(
      "src/strategy/PureShadowPricing.ts:%s - %s safe filler (all constraints met; score=%.3f %s %.3f; Δslack=%.2f A:%s/%.2f R:%s/%.2f)",
      fn, accept ? "ACCEPT" : "REJECT",
      score.totalValue, accept ? "≥" : "<", PureShadowPricing.SAFE_FILLER_THRESHOLD,
      deltaSlack, bottleA, evalAccept.minSlack, bottleR, evalReject.minSlack
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

  // ===== NEW: helper-only mode when bottleneck slack is tight =====
  // When the REJECT-hypothetical bottleneck slack is below our global filler safety margin,
  // do NOT allow a filler—only accept if this person helps an unmet constraint.
  if (evalReject.minSlack < FILLER_MIN_SLACK && !helpsUnmetConstraint) {
    console.log(
      "src/strategy/PureShadowPricing.ts:%s - REJECT filler (tight bottleneck=%s slack=%.2f < threshold=%.2f; Δslack=%.2f)",
      fn, bottleR, evalReject.minSlack, FILLER_MIN_SLACK, deltaSlack
    );
    return { accept: false };
  }

  // Shadow-pricing decision thresholds (existing behavior)
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

  console.log(
    "src/strategy/PureShadowPricing.ts:%s - %s %s (score=%.3f %s %.3f, Σλ=%.3f, cost=%.3f, helps:%s; Δslack=%.2f A:%s/%.2f R:%s/%.2f)",
    fn,
    accept ? "ACCEPT" : "REJECT",
    personType,
    score.totalValue, accept ? "≥" : "<", threshold,
    score.shadowPriceSum, score.seatCost,
    score.helpedAttributes.join(",") || "none",
    deltaSlack, bottleA, evalAccept.minSlack, bottleR, evalReject.minSlack
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