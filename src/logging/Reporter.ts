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

/** Final recap: headline counts, constraint status, AND the scenario's base probabilities again. */
export function logFinalSummary(state: CurrentState): void {
  const fn = "logFinalSummary";
  console.log("src/logging/Reporter.ts:%s - --- FINAL SUMMARY ---", fn);

  const totalSeen = state.admittedCount + state.rejectedCount;
  const admitRate = totalSeen > 0 ? (state.admittedCount / totalSeen) : 0;

  console.log(
    "src/logging/Reporter.ts:%s - admitted=%d rejected=%d (admit rate=%s of %d seen)",
    fn,
    state.admittedCount,
    state.rejectedCount,
    (admitRate * 100).toFixed(1) + "%",
    totalSeen
  );

  console.log("src/logging/Reporter.ts:%s - Constraint status:", fn);
  let allMet = true;
  for (const c of state.constraints) {
    const have = state.admittedAttributes[c.attribute] ?? 0;
    const need = c.minCount;
    const deficit = Math.max(0, need - have);
    if (deficit > 0) allMet = false;
    const share = state.admittedCount > 0 ? ((have / state.admittedCount) * 100).toFixed(1) + "%" : "n/a";
    console.log(
      "src/logging/Reporter.ts:%s -   %s: have=%d (%.1f%% of admits)  min=%d  deficit=%d",
      fn,
      c.attribute,
      have,
      state.admittedCount > 0 ? (have / state.admittedCount) * 100 : 0,
      need,
      deficit
    );
    // ^ line above prints %.1f via formatting in the message; kept explicit numbers for clarity
    // If you prefer strict formatting, replace with the `share` string.
  }
  console.log("src/logging/Reporter.ts:%s - All minima satisfied? %s", fn, allMet ? "YES" : "NO");

  // --- SCENARIO RECAP (so the header info never disappears) ---
  const stats = state.statistics;
  console.log("src/logging/Reporter.ts:%s - --- SCENARIO RECAP ---", fn);

  // Constraints again (helps when scrolling the end only)
  console.log("src/logging/Reporter.ts:%s - Constraints (attribute → minCount):", fn);
  for (const c of state.constraints) {
    console.log("src/logging/Reporter.ts:%s -   %s → %d", fn, c.attribute, c.minCount);
  }

  // Base probabilities again, highlight constrained attrs first for convenience
  const constrainedSet = new Set(state.constraints.map((c) => c.attribute));
  console.log("src/logging/Reporter.ts:%s - Relative Frequencies (constrained attributes):", fn);
  for (const c of state.constraints) {
    const p = stats.relativeFrequencies[c.attribute] ?? 0;
    console.log("src/logging/Reporter.ts:%s -   %s: %s", fn, c.attribute, formatPct(p));
  }

  const others = Object.entries(stats.relativeFrequencies)
    .filter(([attr]) => !constrainedSet.has(attr))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  if (others.length > 0) {
    console.log("src/logging/Reporter.ts:%s - Other Relative Frequencies (top 15):", fn);
    for (const [attr, p] of others) {
      console.log("src/logging/Reporter.ts:%s -   %s: %s", fn, attr, formatPct(p));
    }
  } else {
    console.log("src/logging/Reporter.ts:%s - Other Relative Frequencies: (none - all attributes are constrained)", fn);
  }
}

function formatPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}
