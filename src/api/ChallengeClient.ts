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
    const res = await axios.get(url.toString());
    return res.data as NewGameResponse;
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
    const res = await axios.get(url.toString());
    return res.data as DecideAndNextResponse;
  }
}
