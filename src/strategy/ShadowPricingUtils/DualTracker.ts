// File: src/strategy/DualTracker.ts (relative to project root)
import type { Constraint, AttributeStatistics } from "../../core/types";
import { dashboardEvents } from '../../web/DashboardEvents';

/**
 * Tracks shadow prices (dual variables) λ_c for each constraint c.
 * 
 * Mathematical foundation:
 * λ_c^(t+1) = max(0, λ_c^(t) + η * slack_c^(t))
 * 
 * Where slack_c = expected - safety_buffer - remaining_need
 * - If slack < 0: we're behind → increase λ (more valuable)
 * - If slack > 0: we're ahead → decrease λ (less valuable)
 */
export class DualTracker {
  // λ_c: shadow price for constraint c (attribute → price)
  private duals: Map<string, number> = new Map();
  
  // η: learning rate for dual updates
  private readonly learningRate: number;
  
  // Minimum λ value (prevents going negative)
  private readonly minDual: number = 0.0;
  
  // Maximum λ value (prevents explosion) 
  private readonly maxDual: number = 20.0;

  constructor(learningRate: number = 0.1) {
    this.learningRate = learningRate; // η in the math
    console.log("src/strategy/DualTracker.ts:constructor - initialized with η=%f", learningRate);
  }

/**
 * Initialize λ_c based on attribute rarity (inverse frequency)
 * Mathematical: λ_c^(0) = k / frequency_c (rare → high price, common → low price)
 */
initDuals(constraints: Constraint[], statistics: AttributeStatistics): void {
  const fn = "initDuals";
  this.duals.clear();
  
  // Calculate inverse frequencies for normalization
  const inverseFreqs = constraints.map(c => {
    const freq = statistics.relativeFrequencies[c.attribute] ?? 0.1;
    return { attribute: c.attribute, inverseFreq: 1.0 / Math.max(freq, 0.01) };
  });
  
  // Find min/max for normalization to range [0.5, 5.0]
  const minInverse = Math.min(...inverseFreqs.map(x => x.inverseFreq));
  const maxInverse = Math.max(...inverseFreqs.map(x => x.inverseFreq));
  const range = maxInverse - minInverse;
  
  for (const constraint of constraints) {
    const freq = statistics.relativeFrequencies[constraint.attribute] ?? 0.1;
    const inverseFreq = 1.0 / Math.max(freq, 0.01);
    
    // Normalize to [0.5, 5.0] range: rare gets ~5.0, common gets ~0.5
    const normalizedLambda = range > 0 
      ? 0.5 + 4.5 * ((inverseFreq - minInverse) / range)
      : 2.5; // fallback to middle value
    
    this.duals.set(constraint.attribute, normalizedLambda);
    console.log("src/strategy/DualTracker.ts:%s - initialized λ_%s = %f (freq=%s)", 
      fn, constraint.attribute, normalizedLambda, (freq * 100).toFixed(1) + '%');
  }
  
  console.log("src/strategy/DualTracker.ts:%s - initialized %d frequency-based dual variables", fn, constraints.length);
}

  /**
   * Update shadow prices using subgradient method
   * Mathematical: λ_c^(t+1) = max(0, λ_c^(t) + η * slack_c^(t))
   * 
   * @param slacks - slack_c for each constraint (expected - safety - remaining_need)
   */
  updateDuals(slacks: Record<string, number>): void {
    const fn = "updateDuals";
    const VENUE_CAPACITY = 1000;
    
    for (const [attribute, slack] of Object.entries(slacks)) {
      if (!this.duals.has(attribute)) continue;
      
      // Get current λ_c^(t)
      const currentDual = this.duals.get(attribute)!;

      const scaledSlack = slack / VENUE_CAPACITY;
      // Apply update rule: λ_c^(t+1) = λ_c^(t) + η * slack_c
      const rawUpdate = currentDual - this.learningRate * scaledSlack;
      
      // Project to feasible region: max(minDual, min(maxDual, rawUpdate))
      const newDual = Math.max(this.minDual, Math.min(this.maxDual, rawUpdate));
      
      this.duals.set(attribute, newDual);
      
      console.log("src/strategy/DualTracker.ts:%s - λ_%s: %f + %f*%f = %f → %f", 
        fn, attribute, currentDual, this.learningRate, slack, rawUpdate, newDual);
    }

    const currentDuals = this.getAllDuals();
    dashboardEvents.emit('shadowPrices', {
      shadowPrices: currentDuals,
      slacks: slacks });
    
    console.log("src/strategy/DualTracker.ts:%s - emitted shadow prices to dashboard", fn);
  }

  /**
   * Get current shadow price λ_c for constraint c
   * Mathematical: returns λ_c^(t)
   */
  getDualValue(attribute: string): number {
    return this.duals.get(attribute) ?? 0.0;
  }

  /**
   * Get all current shadow prices
   * Mathematical: returns {λ_c^(t) : c ∈ constraints}
   */
  getAllDuals(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [attr, value] of this.duals.entries()) {
      result[attr] = value;
    }
    return result;
  }
}

// File length: 2,847 characters