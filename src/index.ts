// File: src/index.ts (relative to project root)
import axios from "axios";
import { ChallengeClient } from "./api/ChallengeClient";
import { SimulatedChallengeClient } from "./simulation/SimulatedChallengeClient";
import { config } from "./config/defaults";
import type { DecideAndNextResponse, DecideAndNextRunning } from "./core/types";
import { initState } from "./core/StateTracker";
import { logScenarioIntro, logFinalSummary } from "./logging/Reporter";
import { reportGameComplete } from "./discord/ResultsReporter";
import { dashboardEvents } from './web/DashboardEvents';
import { PacedFeasible } from "./strategy/PacedFeasible";
import { VENUE_CAPACITY, evaluateDecisionFeasibility } from "./core/Feasibility";

const MAX_REJECTIONS = 20000;

async function runOnce(): Promise<number> {
  const fn = "runOnce";
  console.log("src/index.ts:%s - starting run (scenario=%d)", fn, config.SCENARIO);

  const api = config.SIMULATION 
  ? new SimulatedChallengeClient(config.PLAYER_ID)
  : new ChallengeClient(config.PLAYER_ID);

  console.log("src/index.ts:%s - using %s client", fn, config.SIMULATION ? "SIMULATION" : "HTTP");



  const newGame = await api.startNewGame(config.SCENARIO);

  // Print constraints + distributions.
  logScenarioIntro(newGame.constraints, newGame.attributeStatistics);

  // Emit game started event for dashboard
  dashboardEvents.emitGameStarted({
    scenario: config.SCENARIO,
    constraints: newGame.constraints,
    gameId: newGame.gameId
  });

  const state = initState(newGame.constraints, newGame.attributeStatistics);

  let decisionForPrev: boolean | undefined = undefined;
  let personIndex = 0;
  const strategy = new PacedFeasible();

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
        // If the server finished, we must have reached capacity; reflect that in the local summary.
        state.admittedCount = VENUE_CAPACITY;
        logFinalSummary(state);
        return state.rejectedCount;
      }
      throw err;
    }

    if (res.status === "completed") {
      console.log("src/index.ts:%s - GAME COMPLETED", fn);
      // Reflect final counts locally for accurate recap
      state.admittedCount = VENUE_CAPACITY; // venue must be full on completion
      state.rejectedCount = res.rejectedCount;
      logFinalSummary(state);
      
      // Report successful completion to Discord
      await reportGameComplete(state, config.SCENARIO, "completed");
      
      return res.rejectedCount;
    }

    const running = res as DecideAndNextRunning;

    // Sync global totals from server each tick
    state.admittedCount = running.admittedCount;
    state.rejectedCount = running.rejectedCount;

    // If the game is over, the server sends no next person. Break the loop cleanly.
    if (!running.nextPerson) {
      console.log("src/index.ts:%s - No next person; game has ended. Exiting loop.", fn);
      logFinalSummary(state);
      // Optional: Report completion if you have that function
      // await reportGameComplete(state, config.SCENARIO, res.status);
      return state.rejectedCount;
    }


    // Progress ping ~every 100 arrivals (uses REJECT hypothetical to estimate current bottleneck)
    const arrivalsSeen = state.admittedCount + state.rejectedCount;
    if (arrivalsSeen > 0 && arrivalsSeen % 100 === 0) {
      const evalReject = evaluateDecisionFeasibility(state, state.statistics, null, false);
      console.log(
        "src/index.ts:%s - PROGRESS t=%d seats=%d bottleneck=%s slack=%s admitted=%d rejected=%d",
        fn,
        arrivalsSeen,
        evalReject.seatsRemaining,
        evalReject.minSlackAttr ?? "n/a",
        evalReject.minSlack.toFixed(2),
        state.admittedCount,
        state.rejectedCount
      );
    }

    // Early exit if limits reached
    if (state.admittedCount >= VENUE_CAPACITY || state.rejectedCount >= MAX_REJECTIONS) {
      console.log(
        "src/index.ts:%s - LIMIT REACHED | admitted=%d rejected=%d",
        fn,
        state.admittedCount,
        state.rejectedCount
      );
      logFinalSummary(state);
      
      // Report failure to Discord
      const gameStatus = state.admittedCount >= VENUE_CAPACITY ? "completed" : "failed";
      await reportGameComplete(state, config.SCENARIO, gameStatus);
      
      return state.rejectedCount;
    }

    const nextPerson = running.nextPerson;

    // Decide for this person; server applies it on the next request.
    const accept = strategy.shouldAdmitPerson(state, nextPerson);

    // Emit decision event for dashboard
    dashboardEvents.emitDecision({
      personIndex: nextPerson.personIndex,
      person: nextPerson,
      accept,
      reason: accept ? "Strategy approved" : "Strategy rejected",
      timestamp: Date.now()
    });

    // Emit state update with feasibility analysis
    const feasibility = evaluateDecisionFeasibility(state, state.statistics, null, false);
    dashboardEvents.emitStateUpdate({
      ...state,
      feasibility
    });

    // Update only attribute tallies locally if we accepted (totals come from server next tick).
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
