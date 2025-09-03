// File: src/strategy/PacedFeasible.ts (relative to project root)
import type { Person } from "../core/types";
import type { Strategy } from "./Strategy";
import {
  allMinimaMet,
  computeDeficits,
  evaluateDecisionFeasibility,
  FILLER_MIN_SLACK,
} from "../core/Feasibility";

/**
 * Phase 2.5 strategy:
 * - Helpers: compare ACCEPT vs REJECT bottleneck slack and pick the higher (with feasibility guardrails).
 * - Filler: accept only when accept is feasible AND comfortably better than reject.
 */
export class PacedFeasible implements Strategy {
  private static readonly HELPER_EPS = 0.0;   // accept helpers on tie or better
  private static readonly FILLER_MARGIN = 0.3; // was 0.5; allow slightly more filler when safe

  shouldAdmitPerson(state: any, next: Person): boolean {
    const fn = "shouldAdmitPerson";

    const deficits = computeDeficits(state);

    // If every minimum is met, fill remaining seats freely.
    if (allMinimaMet(deficits)) {
      console.log("src/strategy/PacedFeasible.ts:%s - ACCEPT filler (all minima satisfied)", fn);
      return true;
    }

    // Does this person help any still-unmet constraint?
    const helpsAttrs: string[] = [];
    for (const [attr, need] of Object.entries(deficits)) {
      if (need > 0 && next.attributes[attr]) helpsAttrs.push(attr);
    }
    const helps = helpsAttrs.length > 0;

    // Evaluate both choices
    const evalReject = evaluateDecisionFeasibility(
      state,
      state.statistics,
      null,
      false /* reject -> do not consume seat */
    );
    const evalAccept = evaluateDecisionFeasibility(
      state,
      state.statistics,
      next,
      true /* accept -> consume seat, reduce any helped needs by 1 */
    );

    const deltaSlack = evalAccept.minSlack - evalReject.minSlack;
    const bottleA = evalAccept.minSlackAttr ?? "n/a";
    const bottleR = evalReject.minSlackAttr ?? "n/a";

    if (helps) {
      // Helpers: guardrails on feasibility
      if (evalReject.feasible && !evalAccept.feasible) {
        console.log(
          "src/strategy/PacedFeasible.ts:%s - REJECT helper (accept would break feasibility; reject bottleneck=%s slack=%s)",
          fn,
          bottleR,
          evalReject.minSlack.toFixed(2)
        );
        return false;
      }
      if (!evalReject.feasible && evalAccept.feasible) {
        console.log(
          "src/strategy/PacedFeasible.ts:%s - ACCEPT helper (accept restores feasibility; bottleneck=%s slack=%s)",
          fn,
          bottleA,
          evalAccept.minSlack.toFixed(2)
        );
        return true;
      }

      // Both feasible OR both infeasible: accept if we don't make the bottleneck worse.
      if (deltaSlack >= PacedFeasible.HELPER_EPS) {
        console.log(
          "src/strategy/PacedFeasible.ts:%s - ACCEPT helper (Δslack=%s; accept bottleneck=%s slack=%s vs reject %s/%s)",
          fn,
          deltaSlack.toFixed(2),
          bottleA,
          evalAccept.minSlack.toFixed(2),
          bottleR,
          evalReject.minSlack.toFixed(2)
        );
        return true;
      } else {
        console.log(
          "src/strategy/PacedFeasible.ts:%s - REJECT helper (Δslack=%s worsens bottleneck; accept %s/%s vs reject %s/%s)",
          fn,
          deltaSlack.toFixed(2),
          bottleA,
          evalAccept.minSlack.toFixed(2),
          bottleR,
          evalReject.minSlack.toFixed(2)
        );
        return false;
      }
    }

    // Filler: accept only when clearly safe and a bit better than rejecting.
    const threshold =
      Math.max(FILLER_MIN_SLACK, evalReject.minSlack + PacedFeasible.FILLER_MARGIN);

    if (evalAccept.feasible && evalAccept.minSlack >= threshold) {
      console.log(
        "src/strategy/PacedFeasible.ts:%s - ACCEPT filler (accept bottleneck=%s slack=%s ≥ threshold %s)",
        fn,
        bottleA,
        evalAccept.minSlack.toFixed(2),
        threshold.toFixed(2)
      );
      return true;
    } else {
      console.log(
        "src/strategy/PacedFeasible.ts:%s - REJECT filler (accept bottleneck=%s slack=%s < threshold %s)",
        fn,
        bottleA,
        evalAccept.minSlack.toFixed(2),
        threshold.toFixed(2)
      );
      return false;
    }
  }
}
