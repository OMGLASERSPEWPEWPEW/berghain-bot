// File: src/discord/ResultsReporter.ts (relative to project root)
import axios from "axios";
import type { CurrentState } from "../core/types";
import { config } from "../config/defaults";
import { VENUE_CAPACITY } from "../core/Feasibility";

/** Discord bot endpoint configuration */
/** Toggle to disable Discord reporting entirely */
const DISCORD_ENABLED = false;
const DISCORD_BOT_BASE_URL = "http://192.168.1.105:3000";
const BERGHAIN_RESULTS_ENDPOINT = "/berghain-results";

/** Interface for results payload sent to Discord bot */
export interface BerghainResultsPayload {
  scenario: number;
  gameStatus: "completed" | "failed";
  admittedCount: number;
  rejectedCount: number;
  venueCapacity: number;
  constraints: Array<{
    attribute: string;
    minCount: number;
    actualCount: number;
    satisfied: boolean;
    percentage: number;
    deficit: number;
  }>;
  summary: {
    totalSeen: number;
    admitRate: number;
    allConstraintsMet: boolean;
    completionTime: string;
    isPersonalBest: boolean;
  };
  playerId: string;
  playerName: string;
}

/**
 * Main function to report game completion results to Discord
 * @param state - Final game state with all results
 * @param scenario - Scenario number (1, 2, or 3)
 * @param gameStatus - Whether the game was completed successfully or failed
 */
export async function reportGameComplete(
  state: CurrentState, 
  scenario: number, 
  gameStatus: "completed" | "failed"
): Promise<void> {
  const fn = "reportGameComplete";
  
  if (!DISCORD_ENABLED) {
    console.log("src/discord/ResultsReporter.ts:%s - Discord reporting disabled", fn);
    return;
  }
  
  console.log("src/discord/ResultsReporter.ts:%s - reporting scenario %d status %s rejections %d", 
    fn, scenario, gameStatus, state.rejectedCount);
  
  try {
    const payload = formatResultsPayload(state, scenario, gameStatus);
    await sendResultsToDiscord(payload);
    console.log("src/discord/ResultsReporter.ts:%s - successfully sent results to Discord", fn);
  } catch (error) {
    console.error("src/discord/ResultsReporter.ts:%s - failed to send results:", fn, error);
    // Don't throw - we don't want Discord failures to crash the main bot
  }
}

/**
 * Formats game state data into Discord-friendly payload
 * @param state - Current game state
 * @param scenario - Scenario number
 * @param gameStatus - Completion status
 * @returns Formatted payload for Discord
 */
export function formatResultsPayload(
  state: CurrentState, 
  scenario: number, 
  gameStatus: "completed" | "failed"
): BerghainResultsPayload {
  const fn = "formatResultsPayload";
  console.log("src/discord/ResultsReporter.ts:%s - formatting payload for scenario %d", fn, scenario);
  
  const totalSeen = state.admittedCount + state.rejectedCount;
  const admitRate = totalSeen > 0 ? (state.admittedCount / totalSeen) : 0;
  
  // Process constraints with actual vs required counts
  const constraints = state.constraints.map(constraint => {
    const actualCount = state.admittedAttributes[constraint.attribute] ?? 0;
    const satisfied = actualCount >= constraint.minCount;
    const percentage = state.admittedCount > 0 ? (actualCount / state.admittedCount) * 100 : 0;
    const deficit = Math.max(0, constraint.minCount - actualCount);
    
    return {
      attribute: constraint.attribute,
      minCount: constraint.minCount,
      actualCount,
      satisfied,
      percentage: Math.round(percentage * 10) / 10, // Round to 1 decimal
      deficit
    };
  });
  
  const allConstraintsMet = constraints.every(c => c.satisfied);
  const isPersonalBest = gameStatus === "completed" && checkIfPersonalBest(scenario, state.rejectedCount);
  
  console.log("src/discord/ResultsReporter.ts:%s - processed %d constraints, %d satisfied, personal best: %s", 
    fn, constraints.length, constraints.filter(c => c.satisfied).length, isPersonalBest);
  
  return {
    scenario,
    gameStatus,
    admittedCount: state.admittedCount,
    rejectedCount: state.rejectedCount,
    venueCapacity: VENUE_CAPACITY,
    constraints,
    summary: {
      totalSeen,
      admitRate: Math.round(admitRate * 1000) / 10, // Convert to percentage with 1 decimal
      allConstraintsMet,
      completionTime: new Date().toISOString(),
      isPersonalBest
    },
    playerId: config.PLAYER_ID,
    playerName: "Darklight" // From the leaderboard data provided
  };
}

/**
 * Sends the formatted results payload to Discord bot via HTTP POST
 * @param payload - Formatted results data
 */
export async function sendResultsToDiscord(payload: BerghainResultsPayload): Promise<void> {
  const fn = "sendResultsToDiscord";
  console.log("src/discord/ResultsReporter.ts:%s - sending to Discord bot at %s", fn, DISCORD_BOT_BASE_URL);
  
  try {
    const url = `${DISCORD_BOT_BASE_URL}${BERGHAIN_RESULTS_ENDPOINT}`;
    
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Berghain-Bot-Results-Reporter'
      },
      timeout: 10000 // 10 second timeout
    });
    
    console.log("src/discord/ResultsReporter.ts:%s - Discord bot responded with status %d", fn, response.status);
    
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        console.error("src/discord/ResultsReporter.ts:%s - Discord bot not reachable at %s (is it running?)", 
          fn, DISCORD_BOT_BASE_URL);
      } else if (error.response) {
        console.error("src/discord/ResultsReporter.ts:%s - Discord bot returned error %d: %s", 
          fn, error.response.status, error.response.statusText);
      } else if (error.code === 'ENOTFOUND' || error.code === 'EHOSTUNREACH') {
        console.error("src/discord/ResultsReporter.ts:%s - cannot reach Discord bot at %s (network issue)", 
          fn, DISCORD_BOT_BASE_URL);
      } else {
        console.error("src/discord/ResultsReporter.ts:%s - network error:", fn, error.message);
      }
    } else {
      console.error("src/discord/ResultsReporter.ts:%s - unexpected error:", fn, error);
    }
    throw error;
  }
}

/**
 * Simple check if this is a personal best score (basic implementation)
 * In a real implementation, this would check against stored historical scores
 * @param scenario - Scenario number
 * @param rejections - Number of rejections for this run
 * @returns Whether this beats previous best for this scenario
 */
function checkIfPersonalBest(scenario: number, rejections: number): boolean {
  const fn = "checkIfPersonalBest";
  
  // Based on the leaderboard data provided, Darklight's best was 3563 for scenario 1
  const knownBests: Record<number, number> = {
    1: 3563, // Current best from leaderboard
    2: Infinity, // No completion yet
    3: Infinity  // No completion yet
  };
  
  const previousBest = knownBests[scenario] ?? Infinity;
  const isBest = rejections < previousBest;
  
  console.log("src/discord/ResultsReporter.ts:%s - scenario %d: %d rejections vs previous best %d = %s", 
    fn, scenario, rejections, previousBest === Infinity ? "none" : previousBest, isBest ? "NEW BEST!" : "not best");
  
  return isBest;
}

// File length: 5,247 characters