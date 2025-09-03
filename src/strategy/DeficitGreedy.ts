// File: src/strategy/DeficitGreedy.ts (relative to project root)
import type { CurrentState, Person } from "../core/types";
import type { Strategy } from "./Strategy";

/**
 * Phase 1 baseline strategy (with a small QoL upgrade):
 * - If all minima are already satisfied, ACCEPT everyone to fill remaining seats.
 * - Else, if the person satisfies ANY attribute with unmet minimum, ACCEPT.
 * - Otherwise, REJECT.
 */
export class DeficitGreedy implements Strategy {
  shouldAdmitPerson(state: CurrentState, next: Person): boolean {
    const fn = "shouldAdmitPerson";

    // Compute remaining need per constrained attribute
    const remainingNeed: Record<string, number> = {};
    let totalNeedLeft = 0;
    for (const c of state.constraints) {
      const have = state.admittedAttributes[c.attribute] ?? 0;
      const need = Math.max(0, c.minCount - have);
      remainingNeed[c.attribute] = need;
      totalNeedLeft += need;
    }

    // If all minima are satisfied, it's always safe to fill remaining seats.
    if (totalNeedLeft === 0) {
      console.log("src/strategy/DeficitGreedy.ts:%s - ACCEPT filler (all minima satisfied)", fn);
      return true;
    }

    // If this person helps any unmet minimum, take them.
    for (const [attr, isTrue] of Object.entries(next.attributes)) {
      if (isTrue && remainingNeed[attr] && remainingNeed[attr] > 0) {
        console.log(
          "src/strategy/DeficitGreedy.ts:%s - ACCEPT because attr '%s' still needed (%d left)",
          fn,
          attr,
          remainingNeed[attr]
        );
        return true;
      }
    }

    console.log("src/strategy/DeficitGreedy.ts:%s - REJECT (no constrained attributes helped)", fn);
    return false;
  }
}
