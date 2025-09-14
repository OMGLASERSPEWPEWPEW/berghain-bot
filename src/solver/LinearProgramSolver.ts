// File: src/solver/LinearProgramSolver.ts (relative to project root)
import type { ScaledLPProblem, LPConstraint } from "../core/ScaledLP";
import { isLPFeasible, getMaxFeasibleProbability } from "../core/ScaledLP";

/**
 * Solution to a linear programming problem
 */
export interface LPSolution {
  // Core results
  feasible: boolean;
  optimalValue: number; // Objective function value at optimum
  admissionProbability: number; // x* ∈ [0,1] for the person
  
  // Diagnostic information
  activeConstraints: string[]; // Which constraints are tight at the optimum
  constraintSlacks: Record<string, number>; // How much slack each constraint has
  solutionType: 'optimal' | 'infeasible' | 'unbounded';
  
  // Solver metadata
  iterations: number; // For more complex solvers (always 1 for analytical)
  solveTimeMs: number;
}

/**
 * Interface for linear program solvers
 * 
 * This abstraction allows us to swap solvers if needed (analytical, simplex, etc.)
 */
export interface ILinearProgramSolver {
  solve(problem: ScaledLPProblem): LPSolution;
  getName(): string;
}

/**
 * Analytical solver for the single-variable scaled LP
 * 
 * Since our LP has only one variable (admit person or not), we can solve it
 * analytically without requiring a general simplex implementation.
 * 
 * Problem form:
 * max x (admission probability)
 * s.t. current[c] + x*contribution[c] ≤ capacity[c] ∀c
 *      0 ≤ x ≤ 1
 */
export class AnalyticalLPSolver implements ILinearProgramSolver {
  
  getName(): string {
    return "AnalyticalSolver";
  }
  
  solve(problem: ScaledLPProblem): LPSolution {
    const fn = "solve";
    const startTime = Date.now();
    
    console.log("src/solver/LinearProgramSolver.ts:%s - solving LP for person %d with %d constraints", 
      fn, problem.variables[0]?.personIndex ?? -1, problem.constraints.length);
    
    // Check basic feasibility (can we admit at x=0?)
    const basicFeasible = this.checkBasicFeasibility(problem);
    if (!basicFeasible) {
      const solveTime = Date.now() - startTime;
      console.log("src/solver/LinearProgramSolver.ts:%s - LP is infeasible even at x=0", fn);
      return this.createInfeasibleSolution(problem, solveTime);
    }
    
    // Find the maximum feasible admission probability
    const maxProbability = getMaxFeasibleProbability(problem);
    
    // Identify active constraints (those that limit the solution)
    const { activeConstraints, constraintSlacks } = this.analyzeConstraints(problem, maxProbability);
    
    const solveTime = Date.now() - startTime;
    
    const solution: LPSolution = {
      feasible: true,
      optimalValue: maxProbability, // Objective = x since we maximize admission
      admissionProbability: maxProbability,
      activeConstraints,
      constraintSlacks,
      solutionType: 'optimal',
      iterations: 1, // Analytical solution
      solveTimeMs: solveTime
    };
    
    console.log("src/solver/LinearProgramSolver.ts:%s - optimal solution: x*=%.3f, active constraints: [%s], solve time: %dms", 
      fn, maxProbability, activeConstraints.join(','), solveTime);
    
    return solution;
  }
  
  /**
   * Check if LP is feasible at x=0 (baseline feasibility)
   */
  private checkBasicFeasibility(problem: ScaledLPProblem): boolean {
    const fn = "checkBasicFeasibility";
    
    for (const constraint of problem.constraints) {
      if (constraint.currentAdmitted > constraint.scaledCapacity) {
        console.log("src/solver/LinearProgramSolver.ts:%s - constraint %s already violated: %d > %.2f", 
          fn, constraint.attribute, constraint.currentAdmitted, constraint.scaledCapacity);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Analyze which constraints are active and compute slacks at the optimal solution
   */
  private analyzeConstraints(
    problem: ScaledLPProblem, 
    optimalX: number
  ): { activeConstraints: string[]; constraintSlacks: Record<string, number> } {
    const fn = "analyzeConstraints";
    
    const activeConstraints: string[] = [];
    const constraintSlacks: Record<string, number> = {};
    
    const TOLERANCE = 1e-6; // Numerical tolerance for "active" constraints
    
    for (const constraint of problem.constraints) {
      // Calculate slack: capacity - (current + x*contribution)
      const consumption = constraint.currentAdmitted + optimalX * constraint.personContribution;
      const slack = constraint.scaledCapacity - consumption;
      
      constraintSlacks[constraint.attribute] = slack;
      
      // Constraint is active if slack ≈ 0
      if (Math.abs(slack) < TOLERANCE) {
        activeConstraints.push(constraint.attribute);
        console.log("src/solver/LinearProgramSolver.ts:%s - constraint %s is ACTIVE (slack=%.6f)", 
          fn, constraint.attribute, slack);
      } else {
        console.log("src/solver/LinearProgramSolver.ts:%s - constraint %s has slack %.3f", 
          fn, constraint.attribute, slack);
      }
    }
    
    return { activeConstraints, constraintSlacks };
  }
  
  /**
   * Create solution object for infeasible problems
   */
  private createInfeasibleSolution(problem: ScaledLPProblem, solveTimeMs: number): LPSolution {
    const constraintSlacks: Record<string, number> = {};
    
    // Compute how badly each constraint is violated
    for (const constraint of problem.constraints) {
      constraintSlacks[constraint.attribute] = constraint.scaledCapacity - constraint.currentAdmitted;
    }
    
    return {
      feasible: false,
      optimalValue: -Infinity,
      admissionProbability: 0,
      activeConstraints: [],
      constraintSlacks,
      solutionType: 'infeasible',
      iterations: 1,
      solveTimeMs
    };
  }
}

/**
 * Factory function to create the appropriate solver
 * 
 * Currently returns analytical solver, but could be extended to choose
 * based on problem size, complexity, or configuration.
 */
export function createLPSolver(): ILinearProgramSolver {
  return new AnalyticalLPSolver();
}

/**
 * High-level convenience function to solve a scaled LP problem
 * 
 * @param problem The LP problem to solve
 * @param solverType Optional solver type (defaults to analytical)
 * @returns Complete solution with diagnostics
 */
export function solveLPProblem(
  problem: ScaledLPProblem, 
  solverType: 'analytical' = 'analytical'
): LPSolution {
  const fn = "solveLPProblem";
  
  let solver: ILinearProgramSolver;
  
  switch (solverType) {
    case 'analytical':
      solver = new AnalyticalLPSolver();
      break;
    default:
      console.log("src/solver/LinearProgramSolver.ts:%s - unknown solver type '%s', using analytical", 
        fn, solverType);
      solver = new AnalyticalLPSolver();
  }
  
  console.log("src/solver/LinearProgramSolver.ts:%s - using %s for LP with %d variables, %d constraints", 
    fn, solver.getName(), problem.variables.length, problem.constraints.length);
  
  return solver.solve(problem);
}

// File length: 5,547 characters