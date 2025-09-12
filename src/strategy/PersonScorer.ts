// File: src/strategy/PersonScorer.ts (relative to project root)
import type { Person, CurrentState } from "../core/types";
import type { DualTracker } from "./DualTracker";
import { VENUE_CAPACITY } from "../core/Feasibility";

/**
 * Computes person value using shadow prices (dual variables)
 * 
 * Mathematical formula:
 * value(p) = Σ_{c: p helps c} λ_c - seat_cost_risk
 * 
 * Where:
 * - λ_c = shadow price for constraint c
 * - seat_cost_risk = penalty that grows as seats become scarce
 */

/**
 * Calculate seat cost risk based on scarcity
 * Mathematical: seat_cost_risk = α * (1 - remaining_seats/total_seats)^β
 * 
 * @param state - current game state
 * @param costMultiplier - α: base cost multiplier (default 2.0)
 * @param scarcityExponent - β: how aggressively cost grows (default 2.0)
 */
function computeSeatCostRisk(
  state: CurrentState, 
  costMultiplier: number = 3.0,  // α in the formula
  scarcityExponent: number = 3.0  // β in the formula
): number {
  const remainingSeats = VENUE_CAPACITY - state.admittedCount;
  const seatUtilization = 1.0 - (remainingSeats / VENUE_CAPACITY);
  
  // seat_cost_risk = α * utilization^β
  const risk = costMultiplier * Math.pow(seatUtilization, scarcityExponent);
  
  console.log("src/strategy/PersonScorer.ts:computeSeatCostRisk - remaining=%d utilization=%f risk=%f", 
    remainingSeats, seatUtilization, risk);
  
  return risk;
}

/**
 * Score a person using shadow prices
 * Mathematical: value(p) = Σ_{c: p helps c} λ_c - seat_cost_risk
 * 
 * @param person - candidate to score
 * @param dualTracker - contains λ_c values
 * @param state - current game state for seat cost
 */
export function scorePerson(
  person: Person,
  dualTracker: DualTracker,
  state: CurrentState
): { totalValue: number; shadowPriceSum: number; seatCost: number; helpedAttributes: string[] } {
  const fn = "scorePerson";
  
  // Σ_{c: p helps c} λ_c (sum shadow prices for constraints person helps)
  let shadowPriceSum = 0.0;
  const helpedAttributes: string[] = [];
  
  for (const [attribute, hasAttribute] of Object.entries(person.attributes)) {
    if (hasAttribute) {  // Person helps this constraint
      const lambda_c = dualTracker.getDualValue(attribute);  // λ_c
      
      if (lambda_c > 0) {  // Only count constraints we're tracking
        shadowPriceSum += lambda_c;  // Add λ_c to sum
        helpedAttributes.push(attribute);
        
        console.log("src/strategy/PersonScorer.ts:%s - person helps %s: λ=%f", 
          fn, attribute, lambda_c);
      }
    }
  }
  
  // Compute seat cost risk
  const seatCost = computeSeatCostRisk(state);
  
  // Final value: value(p) = Σλ_c - seat_cost_risk
  const totalValue = shadowPriceSum - seatCost;
  
  console.log("src/strategy/PersonScorer.ts:%s - person %d: Σλ=%f - cost=%f = value=%f (helps: %s)", 
    fn, person.personIndex, shadowPriceSum, seatCost, totalValue, helpedAttributes.join(','));
  
  return {
    totalValue,
    shadowPriceSum,
    seatCost,
    helpedAttributes
  };
}

// File length: 2,918 characters