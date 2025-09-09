// File: src/api/ChallengeClient.ts (relative to project root)
import axios from "axios";
import { config } from "../config/defaults";
import type { NewGameResponse, DecideAndNextResponse, UUID } from "../core/types";

/** Simple strongly-typed client for the challenge API. */
export class ChallengeClient {
  private base = config.API_BASE_URL;

  constructor(private readonly playerId: string) {}

  /** Start a new game for a scenario. */
  async startNewGame(scenario: number): Promise<NewGameResponse> {
    const fn = "startNewGame";
    console.log("src/api/ChallengeClient.ts:%s - starting game for scenario %d", fn, scenario);
    const url = new URL("/new-game", this.base);
    url.searchParams.set("scenario", String(scenario));
    url.searchParams.set("playerId", this.playerId);
    
    // Retry logic for network failures
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await axios.get(url.toString());
        return res.data as NewGameResponse;
      } catch (error: any) {
        lastError = error;
        if (axios.isAxiosError(error) && (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED')) {
          console.log("src/api/ChallengeClient.ts:%s - network error attempt %d/3: %s", fn, attempt, error.message);
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 1s, 2s delay
            continue;
          }
        }
        throw error; // Re-throw non-network errors immediately
      }
    }
    throw lastError;
  }
  /**
   * Decide for the previous person and get the next.
   * For personIndex=0, omit `accept` param.
   */
async decideAndNext(gameId: UUID, personIndex: number, accept?: boolean): Promise<DecideAndNextResponse> {
    const fn = "decideAndNext";
    console.log("src/api/ChallengeClient.ts:%s - gameId %s personIndex %d accept %s", fn, gameId, personIndex, String(accept));
    const url = new URL("/decide-and-next", this.base);
    url.searchParams.set("gameId", gameId);
    url.searchParams.set("personIndex", String(personIndex));
    if (accept !== undefined) url.searchParams.set("accept", String(accept));
    
    // Retry logic for network failures
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await axios.get(url.toString());
        return res.data as DecideAndNextResponse;
      } catch (error: any) {
        lastError = error;
        if (axios.isAxiosError(error) && (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED')) {
          console.log("src/api/ChallengeClient.ts:%s - network error attempt %d/3: %s", fn, attempt, error.message);
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 1s, 2s delay
            continue;
          }
        }
        throw error; // Re-throw non-network errors immediately
      }
    }
    throw lastError;
  }
}
