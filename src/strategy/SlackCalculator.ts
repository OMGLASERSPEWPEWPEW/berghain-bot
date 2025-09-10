// File: src/strategy/SlackCalculator.ts (relative to project root)
import type { CurrentState } from "../core/types";
import { VENUE_CAPACITY, SAFETY_Z } from "../core/Feasibility";

/**
 * Computes slack values for dual variable updates
 * 
 * Mathematical formula:
 * slack_c = expected_c - safety_buffer_c - remaining_need_c
 * 
 * Where:
 * - expected_c = p_c * remaining_seats (expected future acquisitions)
 * - safety_buffer_c = Z * sqrt(p_c * (1-p_c) * remaining_seats) (statistical safety)
 * - remaining_need_c = max(0, minCount_c - current_count_c) (deficit)
 * 
 * If slack_c < 0: we're behind → increase λ_c
 * If slack_c > 0: we're ahead → decrease λ_c
 */

export interface SlackResult {
  attribute: string;
  slack: number;
  expected: number;
  safetyBuffer: number;
  remainingNeed: number;
  probability: number;
}

/**
 * Calculate slack for a single constraint
 * Mathematical: slack_c = expected_c - safety_buffer_c - remaining_need_c
 */
function calculateConstraintSlack(
  attribute: string,
  state: CurrentState,
  remainingSeats: number
): SlackResult {
  const fn = "calculateConstraintSlack";
  
  // Get probability p_c from observed statistics
  const probability = state.statistics.relativeFrequencies[attribute] ?? 0.0;  // p_c
  
  // Find constraint to get minCount
  const constraint = state.constraints.find(c => c.attribute === attribute);
  if (!constraint) {
    throw new Error(`Constraint not found for attribute: ${attribute}`);
  }
  
  // remaining_need_c = max(0, minCount_c - current_count_c)
  const currentCount = state.admittedAttributes[attribute] ?? 0;
  const remainingNeed = Math.max(0, constraint.minCount - currentCount);
  
  // expected_c = p_c * remaining_seats
  const expected = probability * remainingSeats;
  
  // safety_buffer_c = Z * sqrt(p_c * (1-p_c) * remaining_seats)
  // This is the standard deviation scaled by safety factor Z
  const variance = probability * (1 - probability) * remainingSeats;
  const standardDeviation = Math.sqrt(Math.max(0, variance));
  const safetyBuffer = SAFETY_Z * standardDeviation;
  
  // slack_c = expected_c - safety_buffer_c - remaining_need_c
  const slack = expected - safetyBuffer - remainingNeed;
  
  console.log("src/strategy/SlackCalculator.ts:%s - %s: expected=%f buffer=%f need=%d slack=%f", 
    fn, attribute, expected, safetyBuffer, remainingNeed, slack);
  
  return {
    attribute,
    slack,
    expected,
    safetyBuffer,
    remainingNeed,
    probability
  };
}

/**
 * Calculate slack for all constraints
 * Returns: {attribute → slack_value} for updateDuals()
 */
export function calculateAllSlacks(state: CurrentState): {
  slacks: Record<string, number>;
  details: SlackResult[];
} {
  const fn = "calculateAllSlacks";
  
  // remaining_seats = total_capacity - admitted_count
  const remainingSeats = VENUE_CAPACITY - state.admittedCount;
  
  console.log("src/strategy/SlackCalculator.ts:%s - calculating slacks with %d seats remaining", 
    fn, remainingSeats);
  
  const slacks: Record<string, number> = {};
  const details: SlackResult[] = [];
  
  // Calculate slack for each constraint
  for (const constraint of state.constraints) {
    const result = calculateConstraintSlack(constraint.attribute, state, remainingSeats);
    
    slacks[constraint.attribute] = result.slack;
    details.push(result);
  }
  
  console.log("src/strategy/SlackCalculator.ts:%s - computed slacks: %s", 
    fn, JSON.stringify(slacks));
  
  return { slacks, details };
}

// File length: 3,254 characters