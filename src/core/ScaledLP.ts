// File: src/core/ScaledLP.ts (relative to project root)
import type { CurrentState, Person, Constraint } from "./types";
import { VENUE_CAPACITY } from "./Feasibility";

/**
 * Linear Program formulation for the primal algorithm
 * 
 * From "Primal Beats Dual" paper:
 * When person t arrives (out of n total expected), solve:
 * 
 * max Σ x_j (maximize total admissions)
 * s.t. admitted_with_attr[c] + x_j*has_attr[c] ≤ (t/n) * min_requirement[c] ∀c
 *      x_j ∈ [0,1] (fractional admission)
 */

export interface LPVariable {
  personIndex: number;
  coefficient: number; // Always 1 for maximizing admissions
}

export interface LPConstraint {
  attribute: string;
  currentAdmitted: number;
  scaledCapacity: number;
  tolerance: number; // Allow being slightly ahead of schedule
  personContribution: number; // 1 if person has this attribute, 0 otherwise
  deficitWeight: number; // How far behind we are (higher = more urgent)
}

export interface ScaledLPProblem {
  // Objective: maximize Σ x_j (admission variables)
  variables: LPVariable[];
  
  // Constraints: current + x_j*contribution ≤ scaled_capacity
  constraints: LPConstraint[];
  
  // Progress tracking
  progressRatio: number; // t/n
  peopleProcessed: number; // t
  expectedTotal: number; // n
}

/**
 * Estimate total expected people based on current game state
 * 
 * Strategy: If we need to fill VENUE_CAPACITY seats and current acceptance rate is r,
 * then we expect to process approximately VENUE_CAPACITY/r total people.
 * 
 * @param state Current game state
 * @returns Estimated total people we'll see before game ends
 */
function estimateExpectedTotal(state: CurrentState): number {
  const fn = "estimateExpectedTotal";
  
  // Fixed realistic estimate: fill 1000-seat venue in 8000 people (12.5% acceptance rate)
  const EXPECTED_TOTAL_PEOPLE = 8000;
  
  console.log("src/core/ScaledLP.ts:%s - using fixed estimate: %d total people", fn, EXPECTED_TOTAL_PEOPLE);
  
  return EXPECTED_TOTAL_PEOPLE;
}

/**
 * Calculate deficit weights for constraints based on how far behind schedule we are
 * 
 * Mathematical: deficit_weight[c] = max(0, expected[c] - current[c])
 * Where expected[c] = progress_ratio * min_requirement[c]
 * 
 * @param constraints Original constraint requirements
 * @param currentAdmitted Current counts per attribute
 * @param progressRatio How far through the game we are (t/n)
 * @returns Deficit weight for each constraint (0 = on track, >0 = behind)
 */
function calculateDeficitWeights(
  constraints: Constraint[],
  currentAdmitted: Record<string, number>,
  progressRatio: number
): Record<string, number> {
  const fn = "calculateDeficitWeights";
  
  const deficitWeights: Record<string, number> = {};
  
  for (const constraint of constraints) {
    const current = currentAdmitted[constraint.attribute] ?? 0;
    const expected = progressRatio * constraint.minCount;
    const deficit = Math.max(0, expected - current);
    
    deficitWeights[constraint.attribute] = deficit;
    
    console.log("src/core/ScaledLP.ts:%s - %s: current=%d, expected=%.1f, deficit=%.1f", 
      fn, constraint.attribute, current, expected, deficit);
  }
  
  return deficitWeights;
}

/**
 * Scale constraint capacities based on progress through the game
 * 
 * Mathematical: scaled_capacity[c] = (t/n) * min_requirement[c]
 * 
 * Intuition: If we're 30% through expected people (t/n = 0.3), 
 * we should have met 30% of each constraint's requirement.
 * 
 * @param constraints Original constraint requirements
 * @param progressRatio t/n where t=people_processed, n=expected_total
 * @returns Scaled capacities for current point in time
 */
function scaleConstraintCapacities(
  constraints: Constraint[], 
  progressRatio: number
): Record<string, { scaledCapacity: number; tolerance: number }> {
  const fn = "scaleConstraintCapacities";
  
  const scaledData: Record<string, { scaledCapacity: number; tolerance: number }> = {};
  
  // Tolerance: allow being 10% ahead of schedule to avoid over-rigid constraints
  const TOLERANCE_FACTOR = 0.10;
  
  for (const constraint of constraints) {
    // scaled_capacity = (t/n) * min_requirement
    const scaledCapacity = progressRatio * constraint.minCount;
    
    // tolerance = 10% of the requirement (allows being ahead)
    const tolerance = TOLERANCE_FACTOR * constraint.minCount;
    
    scaledData[constraint.attribute] = { scaledCapacity, tolerance };
    
    console.log("src/core/ScaledLP.ts:%s - %s: %.1f%% progress * %d requirement = %.2f capacity + %.2f tolerance", 
      fn, constraint.attribute, progressRatio * 100, constraint.minCount, scaledCapacity, tolerance);
  }
  
  return scaledData;
}

/**
 * Formulate the scaled LP problem for a candidate person
 * 
 * Creates the LP: max x_person subject to scaled capacity constraints
 * 
 * @param state Current game state
 * @param candidate Person to make decision about
 * @param expectedTotal Optional override for total expected people
 * @returns LP problem ready for solver
 */
export function formulateScaledLP(
  state: CurrentState, 
  candidate: Person,
  expectedTotal?: number
): ScaledLPProblem {
  const fn = "formulateScaledLP";
  
  // Calculate progress through the game
  const peopleProcessed = state.admittedCount + state.rejectedCount;
  const totalExpected = expectedTotal ?? estimateExpectedTotal(state);
  const progressRatio = Math.min(1.0, peopleProcessed / totalExpected); // Cap at 100%
  
  console.log("src/core/ScaledLP.ts:%s - person %d: %d/%d processed (%.1f%% progress)", 
    fn, candidate.personIndex, peopleProcessed, totalExpected, progressRatio * 100);
  
  // Calculate deficit weights (how far behind each constraint is)
  const deficitWeights = calculateDeficitWeights(state.constraints, state.admittedAttributes, progressRatio);
  
  // Scale constraint capacities with tolerance
  const scaledData = scaleConstraintCapacities(state.constraints, progressRatio);
  
  // Calculate weighted objective coefficient for this person
  let weightedCoefficient = 0;
  for (const constraint of state.constraints) {
    if (candidate.attributes[constraint.attribute]) {
      weightedCoefficient += deficitWeights[constraint.attribute];
    }
  }
  
  console.log("src/core/ScaledLP.ts:%s - person weighted value: %.2f (sum of deficits for helped constraints)", 
    fn, weightedCoefficient);
  
  // Create LP variables (just one: x_candidate with weighted coefficient)
  const variables: LPVariable[] = [{
    personIndex: candidate.personIndex,
    coefficient: weightedCoefficient // Weighted by deficit urgency
  }];
  
  // Create LP constraints for each game constraint
  const lpConstraints: LPConstraint[] = [];
  
  for (const constraint of state.constraints) {
    const currentAdmitted = state.admittedAttributes[constraint.attribute] ?? 0;
    const { scaledCapacity, tolerance } = scaledData[constraint.attribute];
    const personContribution = candidate.attributes[constraint.attribute] ? 1 : 0;
    const deficitWeight = deficitWeights[constraint.attribute];
    
    lpConstraints.push({
      attribute: constraint.attribute,
      currentAdmitted,
      scaledCapacity,
      tolerance,
      personContribution,
      deficitWeight
    });
    
    // Log constraint details for debugging
    const effectiveCapacity = scaledCapacity + tolerance;
    const slack = effectiveCapacity - currentAdmitted;
    console.log("src/core/ScaledLP.ts:%s - constraint %s: %d current + %d*x ≤ %.2f+%.2f=%.2f (slack=%.2f, deficit=%.1f)", 
      fn, constraint.attribute, currentAdmitted, personContribution, 
      scaledCapacity, tolerance, effectiveCapacity, slack, deficitWeight);
  }
  
  return {
    variables,
    constraints: lpConstraints,
    progressRatio,
    peopleProcessed,
    expectedTotal: totalExpected
  };
}

/**
 * Check if the LP is feasible (i.e., x=1 satisfies all constraints with tolerance)
 * 
 * @param lpProblem The formulated LP problem
 * @returns Whether admitting the person (x=1) is feasible
 */
export function isLPFeasible(lpProblem: ScaledLPProblem): boolean {
  const fn = "isLPFeasible";
  
  for (const constraint of lpProblem.constraints) {
    const effectiveCapacity = constraint.scaledCapacity + constraint.tolerance;
    const wouldViolate = constraint.currentAdmitted + constraint.personContribution > effectiveCapacity;
    
    if (wouldViolate) {
      const excess = (constraint.currentAdmitted + constraint.personContribution) - effectiveCapacity;
      console.log("src/core/ScaledLP.ts:%s - constraint %s would be violated by %.2f", 
        fn, constraint.attribute, excess);
      return false;
    }
  }
  
  console.log("src/core/ScaledLP.ts:%s - LP is feasible (x=1 satisfies all constraints)", fn);
  return true;
}

/**
 * Get maximum feasible admission probability
 * 
 * Finds the largest x ∈ [0,1] such that all constraints are satisfied.
 * This is a simple 1D optimization since we only have one variable.
 * 
 * @param lpProblem The formulated LP problem
 * @returns Maximum feasible admission probability x* ∈ [0,1]
 */
export function getMaxFeasibleProbability(lpProblem: ScaledLPProblem): number {
  const fn = "getMaxFeasibleProbability";
  
  let maxProbability = 1.0; // Start optimistic
  
  for (const constraint of lpProblem.constraints) {
    if (constraint.personContribution > 0) {
      // Constraint: current + x*contribution ≤ capacity
      // Solve for x: x ≤ (capacity - current) / contribution
      const availableCapacity = constraint.scaledCapacity - constraint.currentAdmitted;
      const maxForThisConstraint = Math.max(0, availableCapacity / constraint.personContribution);
      
      if (maxForThisConstraint < maxProbability) {
        console.log("src/core/ScaledLP.ts:%s - constraint %s limits x to %.3f (capacity=%.2f, current=%d)", 
          fn, constraint.attribute, maxForThisConstraint, constraint.scaledCapacity, constraint.currentAdmitted);
        maxProbability = maxForThisConstraint;
      }
    }
  }
  
  // Clamp to [0,1] range
  const result = Math.max(0, Math.min(1, maxProbability));
  
  console.log("src/core/ScaledLP.ts:%s - max feasible probability: %.3f", fn, result);
  return result;
}

// File length: 6,247 characters