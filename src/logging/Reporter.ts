// File: src/logging/Reporter.ts (relative to project root)
import type { AttributeStatistics, Constraint, CurrentState } from "../core/types";

/** Pretty-print constraints and stats at the start of a run. */
export function logScenarioIntro(constraints: Constraint[], stats: AttributeStatistics): void {
  const fn = "logScenarioIntro";
  console.log("src/logging/Reporter.ts:%s - --- SCENARIO DETAILS ---", fn);

  console.log("src/logging/Reporter.ts:%s - Constraints (attribute → minCount):", fn);
  for (const c of constraints) {
    console.log("src/logging/Reporter.ts:%s -   %s → %d", fn, c.attribute, c.minCount);
  }

  // Relative frequencies (base probabilities)
  const freqs = Object.entries(stats.relativeFrequencies).sort((a, b) => b[1] - a[1]);
  console.log("src/logging/Reporter.ts:%s - Relative Frequencies (top 20):", fn);
  for (const [attr, p] of freqs.slice(0, 20)) {
    console.log("src/logging/Reporter.ts:%s -   %s: %s", fn, attr, formatPct(p));
  }
  if (freqs.length > 20) {
    console.log("src/logging/Reporter.ts:%s -   (+%d more)", fn, freqs.length - 20);
  }

  // Strongest correlations (by absolute value)
  const pairs: Array<{ a: string; b: string; r: number }> = [];
  for (const a of Object.keys(stats.correlations)) {
    const row = stats.correlations[a] || {};
    for (const b of Object.keys(row)) {
      if (a < b) {
        const r = row[b];
        if (typeof r === "number") pairs.push({ a, b, r });
      }
    }
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const top = pairs.slice(0, 10);
  console.log("src/logging/Reporter.ts:%s - Strongest correlations (top 10 by |r|):", fn);
  for (const p of top) {
    console.log("src/logging/Reporter.ts:%s -   %s × %s: r=%s", fn, p.a, p.b, p.r.toFixed(3));
  }
  if (pairs.length > 10) {
    console.log("src/logging/Reporter.ts:%s -   (+%d more)", fn, pairs.length - 10);
  }
}

/** Final per-constraint status + headline counts. */
export function logFinalSummary(state: CurrentState): void {
  const fn = "logFinalSummary";
  console.log("src/logging/Reporter.ts:%s - --- FINAL SUMMARY ---", fn);
  console.log(
    "src/logging/Reporter.ts:%s - admitted=%d rejected=%d",
    fn,
    state.admittedCount,
    state.rejectedCount
  );
  console.log("src/logging/Reporter.ts:%s - Constraint status:", fn);
  let allMet = true;
  for (const c of state.constraints) {
    const have = state.admittedAttributes[c.attribute] ?? 0;
    const need = c.minCount;
    const deficit = Math.max(0, need - have);
    if (deficit > 0) allMet = false;
    console.log(
      "src/logging/Reporter.ts:%s -   %s: have=%d min=%d deficit=%d",
      fn,
      c.attribute,
      have,
      need,
      deficit
    );
  }
  console.log("src/logging/Reporter.ts:%s - All minima satisfied? %s", fn, allMet ? "YES" : "NO");
}

function formatPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}
