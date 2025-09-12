// File: src/core/Feasibility.ts (relative to project root)
import type { AttributeStatistics, CurrentState, Person } from "./types";

/**
 * Parameters controlling how conservative we are.
 * Z is a one-sided safety margin in units of standard deviations.
 *   - 0.0  ~ use pure expectation (aggressive)
 *   - 1.0  ~ ~84% one-sided comfort
 *   - 1.3  ~ ~90%
 *   - 1.65 ~ ~95%
 */
export const VENUE_CAPACITY = 1000;
export const SAFETY_Z = 1.15;        // mild buffer; we’ll tune later
export const FILLER_MIN_SLACK = 0.8; // require at least ~0.8 expected spare across all constraints to accept filler

export type FeasibilityPerAttr = {
  need: number;       // remaining required count after the hypothetical decision
  expected: number;   // p * seatsRemaining
  sd: number;         // sqrt(p*(1-p)*seatsRemaining)
  slack: number;      // expected - Z*sd - need   (>=0 means "likely safe")
  feasible: boolean;  // slack >= 0
};

export type FeasibilityResult = {
  feasible: boolean;
  seatsRemaining: number;
  perAttr: Record<string, FeasibilityPerAttr>;
  minSlackAttr: string | null;
  minSlack: number; // the bottleneck slack (can be negative)
};

/** Compute remaining seats given current server-admitted count. */
export function remainingSeats(state: CurrentState, acceptSeat: boolean): number {
  const currentRemaining = VENUE_CAPACITY - state.admittedCount;
  return acceptSeat ? currentRemaining - 1 : currentRemaining;
}

/** Build the deficits map from constraints vs. admitted attributes. */
export function computeDeficits(state: CurrentState): Record<string, number> {
  const deficits: Record<string, number> = {};
  for (const c of state.constraints) {
    const have = state.admittedAttributes[c.attribute] ?? 0;
    deficits[c.attribute] = Math.max(0, c.minCount - have);
  }
  return deficits;
}

/** True when all minima are already satisfied. */
export function allMinimaMet(deficits: Record<string, number>): boolean {
  for (const v of Object.values(deficits)) if (v > 0) return false;
  return true;
}

/**
 * Evaluate whether (probabilistically) we can still hit all minima after a hypothetical decision.
 * If `person` is provided and `acceptSeat` is true, we reduce any satisfied deficits by that person’s attributes.
 */
export function evaluateDecisionFeasibility(
  state: CurrentState,
  stats: AttributeStatistics,
  person: Person | null,
  acceptSeat: boolean
): FeasibilityResult {
  const seats = remainingSeats(state, acceptSeat);
  const pmap = stats.relativeFrequencies;
  const perAttr: Record<string, FeasibilityPerAttr> = {};

  // Apply hypothetical: if accepting, person may reduce some needs.
  const deficits = computeDeficits(state);
  if (acceptSeat && person) {
    for (const [attr, hasIt] of Object.entries(person.attributes)) {
      if (hasIt && deficits[attr] !== undefined) {
        deficits[attr] = Math.max(0, deficits[attr] - 1);
      }
    }
  }

  let feasible = true;
  let minSlack = Number.POSITIVE_INFINITY;
  let minSlackAttr: string | null = null;

  for (const [attr, need] of Object.entries(deficits)) {
    const p = clamp01(pmap[attr] ?? 0);
    const expected = p * Math.max(0, seats);
    const var_ = p * (1 - p) * Math.max(0, seats);
    const sd = Math.sqrt(var_);
    const slack = expected - SAFETY_Z * sd - need;
    const ok = slack >= 0;

    perAttr[attr] = { need, expected, sd, slack, feasible: ok };
    if (!ok) feasible = false;

    if (need > 0 && slack < minSlack) {
          minSlack = slack;
          minSlackAttr = attr;
        }
  }

  // If there are no constrained attributes (shouldn’t happen), treat as feasible.
  if (!isFinite(minSlack)) {
    minSlack = 0;
    minSlackAttr = null;
  }

  return { feasible, seatsRemaining: Math.max(0, seats), perAttr, minSlack, minSlackAttr };
}


export function evaluateDecisionFeasibilityByLine(
  state: CurrentState,
  stats: AttributeStatistics,
  person: Person | null,
  acceptSeat: boolean
): FeasibilityResult {
  const totalPeople = 20000; // Total people in line
  const peopleSeen = state.admittedCount + state.rejectedCount;
  const remainingPeopleInLine = totalPeople - peopleSeen;
  
  const pmap = stats.relativeFrequencies;
  const perAttr: Record<string, FeasibilityPerAttr> = {};

  // Apply hypothetical: if accepting, person may reduce some needs
  const deficits = computeDeficits(state);
  if (acceptSeat && person) {
    for (const [attr, hasIt] of Object.entries(person.attributes)) {
      if (hasIt && deficits[attr] !== undefined) {
        deficits[attr] = Math.max(0, deficits[attr] - 1);
      }
    }
  }

  let feasible = true;
  let minSlack = Number.POSITIVE_INFINITY;
  let minSlackAttr: string | null = null;

  for (const [attr, need] of Object.entries(deficits)) {
    const p = clamp01(pmap[attr] ?? 0);
    // Expected people of this type still coming
    const expected = p * Math.max(0, remainingPeopleInLine);
    const var_ = p * (1 - p) * Math.max(0, remainingPeopleInLine);
    const sd = Math.sqrt(var_);
    const slack = expected - SAFETY_Z * sd - need;
    const ok = slack >= 0;

    perAttr[attr] = { need, expected, sd, slack, feasible: ok };
    if (!ok) feasible = false;

    if (need > 0 && slack < minSlack) {
      minSlack = slack;
      minSlackAttr = attr;
    }
  }

  if (!isFinite(minSlack)) {
    minSlack = 0;
    minSlackAttr = null;
  }

  const remainingSeatsForCompatibility = VENUE_CAPACITY - state.admittedCount;
  return { 
    feasible, 
    seatsRemaining: Math.max(0, remainingSeatsForCompatibility), 
    perAttr, 
    minSlack, 
    minSlackAttr 
  };
}


function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
