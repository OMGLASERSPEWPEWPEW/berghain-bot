// File: src/index.ts (relative to project root)
import axios from "axios";
import { ChallengeClient } from "./api/ChallengeClient";
import { config } from "./config/defaults";
import type { DecideAndNextResponse, DecideAndNextRunning } from "./core/types";
import { initState } from "./core/StateTracker";
import { DeficitGreedy } from "./strategy/DeficitGreedy";
import { logScenarioIntro, logFinalSummary } from "./logging/Reporter";

const VENUE_CAPACITY = 1000;
const MAX_REJECTIONS = 20000;

async function runOnce(): Promise<number> {
  const fn = "runOnce";
  console.log("src/index.ts:%s - starting run (scenario=%d)", fn, config.SCENARIO);

  const api = new ChallengeClient(config.PLAYER_ID);
  const newGame = await api.startNewGame(config.SCENARIO);

  // Print constraints + distributions so you can see exactly what the game gave us.
  logScenarioIntro(newGame.constraints, newGame.attributeStatistics);

  const state = initState(newGame.constraints, newGame.attributeStatistics);

  let decisionForPrev: boolean | undefined = undefined;
  let personIndex = 0;
  const strategy = new DeficitGreedy();

  while (true) {
    let res: DecideAndNextResponse;

    try {
      res = await api.decideAndNext(newGame.gameId, personIndex, decisionForPrev);
    } catch (err: any) {
      // Gracefully handle "Game is already finished" from the server.
      if (
        axios.isAxiosError(err) &&
        err.response?.status === 400 &&
        typeof err.response.data?.error === "string" &&
        err.response.data.error.toLowerCase().includes("finished")
      ) {
        console.log("src/index.ts:%s - SERVER SAYS FINISHED", fn);
        logFinalSummary(state);
        return state.rejectedCount;
      }
      throw err;
    }

    if (res.status === "completed") {
      console.log("src/index.ts:%s - GAME COMPLETED", fn);
      // Sync the final rejected count for the summary
      state.rejectedCount = res.rejectedCount;
      logFinalSummary(state);
      return res.rejectedCount;
    }

    const running = res as DecideAndNextRunning;

    // Sync global totals from server each tick
    state.admittedCount = running.admittedCount;
    state.rejectedCount = running.rejectedCount;

    // Early exit if limits are reached
    if (state.admittedCount >= VENUE_CAPACITY || state.rejectedCount >= MAX_REJECTIONS) {
      console.log(
        "src/index.ts:%s - LIMIT REACHED | admitted=%d rejected=%d",
        fn,
        state.admittedCount,
        state.rejectedCount
      );
      logFinalSummary(state);
      return state.rejectedCount;
    }

    const nextPerson = running.nextPerson;

    // Decide for this person now; the server applies it on the next request.
    const accept = strategy.shouldAdmitPerson(state, nextPerson);

    // Update only attribute tallies locally (totals come from server on next loop)
    if (accept) {
      for (const [attr, val] of Object.entries(nextPerson.attributes)) {
        if (val && attr in state.admittedAttributes) {
          state.admittedAttributes[attr] = (state.admittedAttributes[attr] ?? 0) + 1;
        }
      }
    }

    // Prepare next loop
    decisionForPrev = accept;
    personIndex = nextPerson.personIndex;
  }
}

runOnce().catch((err) => {
  console.error("src/index.ts:runOnce - Unhandled error:", err);
  process.exit(1);
});
