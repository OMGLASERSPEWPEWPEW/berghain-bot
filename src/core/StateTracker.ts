// File: src/core/StateTracker.ts (relative to project root)
import type { Constraint, CurrentState, Person } from "./types";

/** Initialize CurrentState from constraints/statistics. */
export function initState(constraints: Constraint[], statistics: CurrentState["statistics"]): CurrentState {
  const admittedAttributes: Record<string, number> = {};
  for (const c of constraints) admittedAttributes[c.attribute] = 0;
  console.log("src/core/StateTracker.ts:initState - initialized state with %d constraints", constraints.length);
  return {
    admittedCount: 0,
    rejectedCount: 0,
    admittedAttributes,
    constraints,
    statistics
  };
}

/** Update the state after a decision for a person. */
export function updateStateAfterDecision(state: CurrentState, person: Person, accepted: boolean): void {
  const fn = "updateStateAfterDecision";
  if (accepted) {
    state.admittedCount += 1;
    // For every attribute that exists on constraints, increment when true.
    for (const [attr, val] of Object.entries(person.attributes)) {
      if (val && attr in state.admittedAttributes) {
        state.admittedAttributes[attr] = (state.admittedAttributes[attr] ?? 0) + 1;
      }
    }
  } else {
    state.rejectedCount += 1;
  }
  console.log("src/core/StateTracker.ts:%s - admitted=%d rejected=%d", fn, state.admittedCount, state.rejectedCount);
}
