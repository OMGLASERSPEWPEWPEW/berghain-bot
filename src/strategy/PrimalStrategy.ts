// File: src/strategy/PrimalStrategy.ts (relative to project root)
import type { CurrentState, Person } from "../core/types";
import type { Strategy, StrategyDecision } from "./Strategy";
import { formulateScaledLP } from "../core/ScaledLP";
import { solveLPProblem } from "../solver/LinearProgramSolver";
import { VENUE_CAPACITY } from "../core/Feasibility";

/**
 * Primal algorithm implementation based on "Primal Beats Dual on Online Packing LPs"
 * 
 * Algorithm 1 from the paper:
 * 1. When person t arrives (out of n expected total)
 * 2. Formulate scaled LP: max x s.t. current[c] + x*has[c] ≤ (t/n)*requirement[c]
 * 3. Solve LP to get optimal admission probability x*
 * 4. Admit person with probability x* (random rounding)
 * 
 * Key insight: Rather than maintaining dual prices, solve the actual optimization
 * problem at each step using scaled constraint capacities.
 */
export class PrimalStrategy implements Strategy {
  private totalLPSolves: number = 0;
  private totalSolveTimeMs: number = 0;
  private admissionsByProbability: { probability: number; admitted: boolean }[] = [];
  
  // Hyperparameters
  private static readonly MIN_PROBABILITY_THRESHOLD = 0.001;  // Don't bother with tiny probabilities
  private static readonly RANDOM_SEED_OFFSET = 42;            // For reproducible randomness (if needed)
  
  constructor() {
    console.log("src/strategy/PrimalStrategy.ts:constructor - initialized primal strategy (Algorithm 1)");
  }

  shouldAdmitPerson(state: CurrentState, next: Person): StrategyDecision {
    const fn = "shouldAdmitPerson";
    const startTime = Date.now();
    
    console.log("src/strategy/PrimalStrategy.ts:%s - evaluating person %d with attributes: %s", 
      fn, next.personIndex, Object.entries(next.attributes)
        .filter(([, has]) => has)
        .map(([attr]) => attr)
        .join(',') || 'none');
    
    // Check if venue is full (shouldn't happen but safety check)
    if (state.admittedCount >= VENUE_CAPACITY) {
      console.log("src/strategy/PrimalStrategy.ts:%s - venue full, rejecting person %d", fn, next.personIndex);
      return { 
        accept: false,
        scoring: {
          admissionProbability: 0,
          lpOptimalValue: 0,
          activeConstraints: [],
          feasible: false
        }
      };
    }
    
    // Step 1: Formulate the scaled LP problem
    const lpProblem = formulateScaledLP(state, next);
    
    // Step 2: Solve the LP to get optimal admission probability
    const solution = solveLPProblem(lpProblem);
    this.totalLPSolves++;
    this.totalSolveTimeMs += solution.solveTimeMs;
    
    // Step 3: Handle infeasible case
    if (!solution.feasible) {
      console.log("src/strategy/PrimalStrategy.ts:%s - LP infeasible, rejecting person %d", fn, next.personIndex);
      return {
        accept: false,
        scoring: {
          admissionProbability: 0,
          lpOptimalValue: solution.optimalValue,
          activeConstraints: solution.activeConstraints,
          feasible: false
        }
      };
    }
    
    // Step 4: Random rounding based on optimal probability
    const admissionProbability = solution.admissionProbability;
    const accept = this.makeRandomDecision(admissionProbability, next.personIndex);
    
    // Track admission patterns for analysis
    this.admissionsByProbability.push({ probability: admissionProbability, admitted: accept });
    
    const totalTime = Date.now() - startTime;
    
    console.log("src/strategy/PrimalStrategy.ts:%s - %s person %d (LP: x*=%.3f, %s, active: [%s], time: %dms)", 
      fn, 
      accept ? "ACCEPT" : "REJECT", 
      next.personIndex,
      admissionProbability,
      solution.solutionType,
      solution.activeConstraints.join(','),
      totalTime);
    
    // Log constraint analysis for debugging
    this.logConstraintAnalysis(solution, next);
    
    return {
      accept,
      scoring: {
        admissionProbability,
        lpOptimalValue: solution.optimalValue,
        activeConstraints: solution.activeConstraints,
        feasible: solution.feasible,
        constraintSlacks: solution.constraintSlacks
      }
    };
  }
  
  /**
   * Make randomized admission decision based on LP optimal probability
   * 
   * Uses Math.random() for the random rounding step of Algorithm 1.
   * Could be made deterministic with seeded random if needed.
   */
  private makeRandomDecision(probability: number, personIndex: number): boolean {
    const fn = "makeRandomDecision";
    
    // Skip tiny probabilities to avoid noise
    if (probability < PrimalStrategy.MIN_PROBABILITY_THRESHOLD) {
      console.log("src/strategy/PrimalStrategy.ts:%s - probability %.6f below threshold, rejecting", 
        fn, probability);
      return false;
    }
    
    // Clamp probability to valid range
    const clampedProb = Math.max(0, Math.min(1, probability));
    
    // Generate random number for decision
    const randomValue = Math.random();
    const accept = randomValue < clampedProb;
    
    console.log("src/strategy/PrimalStrategy.ts:%s - person %d: random %.3f %s %.3f → %s", 
      fn, personIndex, randomValue, accept ? "<" : "≥", clampedProb, accept ? "ADMIT" : "REJECT");
    
    return accept;
  }
  
  /**
   * Log detailed constraint analysis for debugging and monitoring
   */
  private logConstraintAnalysis(solution: any, person: Person): void {
    const fn = "logConstraintAnalysis";
    
    if (!solution.constraintSlacks) return;
    
    // Find tightest constraints (smallest slack)
    const constraintDetails = Object.entries(solution.constraintSlacks)
      .map(([attr, slack]) => ({ 
        attr, 
        slack: slack as number, 
        personHas: person.attributes[attr] || false 
      }))
      .sort((a, b) => a.slack - b.slack); // Tightest first
    
    const tightestConstraints = constraintDetails
      .filter(c => c.slack < 0.1) // Very tight
      .map(c => `${c.attr}:${c.slack.toFixed(2)}${c.personHas ? '*' : ''}`)
      .join(', ');
    
    if (tightestConstraints) {
      console.log("src/strategy/PrimalStrategy.ts:%s - tight constraints: %s (* = person helps)", 
        fn, tightestConstraints);
    }
    
    // Count how many constraints this person helps vs hurts
    const helps = constraintDetails.filter(c => c.personHas).length;
    const total = constraintDetails.length;
    
    console.log("src/strategy/PrimalStrategy.ts:%s - person helps %d/%d constraints", fn, helps, total);
  }
  
  /**
   * Get strategy performance statistics
   */
  public getPerformanceStats(): {
    totalLPSolves: number;
    averageSolveTimeMs: number;
    admissionProbabilityDistribution: { mean: number; min: number; max: number };
    calibration: { expectedAdmissions: number; actualAdmissions: number };
  } {
    const avgSolveTime = this.totalLPSolves > 0 ? this.totalSolveTimeMs / this.totalLPSolves : 0;
    
    const probabilities = this.admissionsByProbability.map(a => a.probability);
    const meanProb = probabilities.length > 0 ? probabilities.reduce((a, b) => a + b, 0) / probabilities.length : 0;
    const minProb = probabilities.length > 0 ? Math.min(...probabilities) : 0;
    const maxProb = probabilities.length > 0 ? Math.max(...probabilities) : 0;
    
    const expectedAdmissions = probabilities.reduce((sum, prob) => sum + prob, 0);
    const actualAdmissions = this.admissionsByProbability.filter(a => a.admitted).length;
    
    return {
      totalLPSolves: this.totalLPSolves,
      averageSolveTimeMs: avgSolveTime,
      admissionProbabilityDistribution: {
        mean: meanProb,
        min: minProb,
        max: maxProb
      },
      calibration: {
        expectedAdmissions,
        actualAdmissions
      }
    };
  }
  
  /**
   * Reset strategy state (useful for testing multiple runs)
   */
  public reset(): void {
    console.log("src/strategy/PrimalStrategy.ts:reset - resetting strategy state");
    this.totalLPSolves = 0;
    this.totalSolveTimeMs = 0;
    this.admissionsByProbability = [];
  }
}

// File length: 6,247 characters