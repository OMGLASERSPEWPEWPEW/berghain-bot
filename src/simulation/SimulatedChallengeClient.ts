// File: src/simulation/SimulatedChallengeClient.ts (relative to project root)
import type { NewGameResponse, DecideAndNextResponse, UUID } from "../core/types";
import { BerghainSimulator } from "./BerghainSimulator";

/**
 * Drop-in replacement for ChallengeClient that uses local simulation
 * instead of making HTTP requests to the real Berghain Challenge API.
 */
export class SimulatedChallengeClient {
  private simulator: BerghainSimulator;

  constructor(private readonly playerId: string) {
    this.simulator = new BerghainSimulator();
    console.log("src/simulation/SimulatedChallengeClient.ts:constructor - initialized simulation client for player %s", playerId);
  }

  /** Start a new game for a scenario. */
  async startNewGame(scenario: number): Promise<NewGameResponse> {
    const fn = "startNewGame";
    console.log("src/simulation/SimulatedChallengeClient.ts:%s - starting simulated game for scenario %d", fn, scenario);
    
    // Add a small delay to simulate network latency
    await this.simulateNetworkDelay(100, 300);
    
    return this.simulator.startNewGame(scenario);
  }

  /**
   * Decide for the previous person and get the next.
   * For personIndex=0, omit `accept` param.
   */
  async decideAndNext(gameId: UUID, personIndex: number, accept?: boolean): Promise<DecideAndNextResponse> {
    const fn = "decideAndNext";
    console.log("src/simulation/SimulatedChallengeClient.ts:%s - gameId %s personIndex %d accept %s", fn, gameId, personIndex, String(accept));
    
    // Add a small delay to simulate network latency
    await this.simulateNetworkDelay(50, 150);
    
    return this.simulator.decideAndNext(gameId, personIndex, accept);
  }

  /**
   * Simulates network delay for more realistic testing
   */
  private async simulateNetworkDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.random() * (maxMs - minMs) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Gets debug information about the current game state
   */
  getGameState(gameId: UUID) {
    return this.simulator.getGameState(gameId);
  }

  /**
   * Cleans up finished games (useful for long-running processes)
   */
  cleanup(): void {
    this.simulator.cleanupFinishedGames();
  }
}

// File length: 1,892 characters