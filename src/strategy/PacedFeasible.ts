// File: src/strategy/PacedFeasible.ts (relative to project root)
import type { CurrentState, Person } from "../core/types";
import type { Strategy } from "./Strategy";
import {
  allMinimaMet,
  computeDeficits,
  evaluateDecisionFeasibility,
  FILLER_MIN_SLACK,
} from "../core/Feasibility";

/**
 * Phase 2 (delta-slack version):
 *
 * 1) If all minima are satisfied -> ACCEPT everyone (safe filler).
 * 2) Compute feasibility for both choices:
 *      - evalReject: after REJECTING this person (no seat used, needs unchanged)
 *      - evalAccept: after ACCEPTING this person (one seat used, needs possibly reduced)
 *    Compare their minSlack (bottleneck slack).
 * 3) If the person HELPS any unmet minimum:
 *      - If evalReject is feasible and evalAccept is not -> REJECT (accepting would break feasibility).
 *      - If evalAccept is feasible and evalReject is not -> ACCEPT (we improve to feasible).
 *      - Otherwise (both feasible or both infeasible):
 *            ACCEPT if deltaSlack >= 0 (accept doesn’t worsen the bottleneck), else REJECT.
 * 4) If the person does NOT help any unmet min (filler):
 *      - ACCEPT only if evalAccept is feasible AND has comfortable slack:
 *            evalAccept.minSlack >= max(FILLER_MIN_SLACK, evalReject.minSlack + FILLER_MARGIN)
 *        Otherwise REJECT.
 *
 * This avoids the "reject-everyone" deadlock when initial slack is negative,
 * while still preventing unsafe filler that would starve scarce constraints.
 */
export class PacedFeasible implements Strategy {
  private static readonly HELPER_EPS = 0.0;   // we accept helpers on tie or better
  private static readonly FILLER_MARGIN = 0.3; // filler must improve slack by a bit

  shouldAdmitPerson(state: CurrentState, next: Person): boolean {
    const fn = "shouldAdmitPerson";

    const deficits = computeDeficits(state);

    // If every minimum is met, fill remaining seats freely.
    if (allMinimaMet(deficits)) {
      console.log("src/strategy/PacedFeasible.ts:%s - ACCEPT filler (all minima satisfied)", fn);
      return true;
    }

    // Does this person help any still-unmet constraint? Track which ones.
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
      // Helpers: pick the option with better bottleneck slack, with guardrails.
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

    // Filler: only accept when it’s clearly safe and a bit better than rejecting.
    const fillerThreshold = Math.max(FILLER_MIN_SLACK, evalReject.minSlack + PacedFeasible.FILLER_MARGIN);
    if (evalAccept.feasible && evalAccept.minSlack >= fillerThreshold) {
      console.log(
        "src/strategy/PacedFeasible.ts:%s - ACCEPT filler (accept bottleneck=%s slack=%s ≥ threshold %s)",
        fn,
        bottleA,
        evalAccept.minSlack.toFixed(2),
        fillerThreshold.toFixed(2)
      );
      return true;
    } else {
      console.log(
        "src/strategy/PacedFeasible.ts:%s - REJECT filler (accept bottleneck=%s slack=%s < threshold %s)",
        fn,
        bottleA,
        evalAccept.minSlack.toFixed(2),
        fillerThreshold.toFixed(2)
      );
      return false;
    }
  }
}
