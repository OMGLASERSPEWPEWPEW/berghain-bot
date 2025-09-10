// File: src/simulation/BerghainSimulator.ts (relative to project root)
import type { 
  NewGameResponse, 
  DecideAndNextResponse, 
  UUID, 
  Person, 
  Constraint, 
  AttributeStatistics,
  DecideAndNextRunning,
  DecideAndNextCompleted,
  DecideAndNextFailed
} from "../core/types";

interface SimulationConfig {
  constraints: Constraint[];
  attributeStatistics: AttributeStatistics;
  maxRejections: number;
  venueCapacity: number;
}

interface GameState {
  gameId: UUID;
  config: SimulationConfig;
  admittedCount: number;
  rejectedCount: number;
  currentPersonIndex: number;
  isFinished: boolean;
  status: "running" | "completed" | "failed";
}

/**
 * Simulates the Berghain Challenge API locally when the real service is unavailable.
 * Generates people with attributes based on provided probabilities and correlations.
 */
export class BerghainSimulator {
  private games = new Map<UUID, GameState>();
  private scenarios: Record<number, SimulationConfig>;

  constructor() {
    this.scenarios = {
      1: this.createScenario1Config(),
      2: this.createScenario2Config(), 
      3: this.createScenario3Config()
    };
  }

  /**
   * Creates the scenario configuration matching your provided data
   */
  private createScenario1Config(): SimulationConfig {
    const constraints: Constraint[] = [
      { attribute: "techno_lover", minCount: 650 },
      { attribute: "well_connected", minCount: 450 },
      { attribute: "creative", minCount: 300 },
      { attribute: "berlin_local", minCount: 750 }
    ];

    const relativeFrequencies: Record<string, number> = {
      "techno_lover": 0.627,
      "well_connected": 0.470,
      "creative": 0.062,
      "berlin_local": 0.398,
      // Add some unconstrained attributes for realism
    //   "regular_visitor": 0.245,
    //   "artist": 0.183,
    //   "fashion_forward": 0.332,
    //   "young": 0.425,
    //   "international": 0.602,
    //   "nightlife_veteran": 0.156
    };

    // Simple correlation matrix - in reality this would be more complex
    const correlations: Record<string, Record<string, number>> = {};
    const attributes = Object.keys(relativeFrequencies);
    
    for (const attr1 of attributes) {
      correlations[attr1] = {};
      for (const attr2 of attributes) {
        if (attr1 === attr2) {
          correlations[attr1][attr2] = 1.0;
        } else {
          // Generate mild correlations between related attributes
          let correlation = 0;
          if ((attr1 === "techno_lover" && attr2 === "berlin_local") ||
              (attr1 === "berlin_local" && attr2 === "techno_lover")) {
            correlation = 0.15;
          } else if ((attr1 === "creative" && attr2 === "artist") ||
                     (attr1 === "artist" && attr2 === "creative")) {
            correlation = 0.35;
          } else if ((attr1 === "well_connected" && attr2 === "regular_visitor") ||
                     (attr1 === "regular_visitor" && attr2 === "well_connected")) {
            correlation = 0.25;
          } else {
            // Random small correlations for other pairs
            correlation = (Math.random() - 0.5) * 0.1;
          }
          correlations[attr1][attr2] = correlation;
        }
      }
    }

    return {
      constraints,
      attributeStatistics: {
        relativeFrequencies,
        correlations
      },
      maxRejections: 20000,
      venueCapacity: 1000
    };
  }

  private createScenario2Config(): SimulationConfig {
    // More challenging scenario
    return {
      constraints: [
        { attribute: "berlin_local", minCount: 400 },
        { attribute: "techno_lover", minCount: 800 },
        { attribute: "creative", minCount: 150 },
        { attribute: "well_connected", minCount: 600 },
        { attribute: "fashion_forward", minCount: 350 }
      ],
      attributeStatistics: {
        relativeFrequencies: {
          "berlin_local": 0.398,
          "techno_lover": 0.627,
          "creative": 0.062,
          "well_connected": 0.470,
          "fashion_forward": 0.332,
          "young": 0.425,
          "artist": 0.183,
          "regular_visitor": 0.245
        },
        correlations: {}
      },
      maxRejections: 20000,
      venueCapacity: 1000
    };
  }

  private createScenario3Config(): SimulationConfig {
    // Most challenging scenario
    return {
      constraints: [
        { attribute: "creative", minCount: 180 },
        { attribute: "berlin_local", minCount: 350 },
        { attribute: "techno_lover", minCount: 900 },
        { attribute: "well_connected", minCount: 700 },
        { attribute: "fashion_forward", minCount: 400 },
        { attribute: "artist", minCount: 100 }
      ],
      attributeStatistics: {
        relativeFrequencies: {
          "creative": 0.062,
          "berlin_local": 0.398,
          "techno_lover": 0.627,
          "well_connected": 0.470,
          "fashion_forward": 0.332,
          "artist": 0.183,
          "young": 0.425,
          "regular_visitor": 0.245
        },
        correlations: {}
      },
      maxRejections: 20000,
      venueCapacity: 1000
    };
  }

  /**
   * Starts a new simulated game
   */
  async startNewGame(scenario: number): Promise<NewGameResponse> {
    const fn = "startNewGame";
    console.log("src/simulation/BerghainSimulator.ts:%s - starting simulated game for scenario %d", fn, scenario);
    
    const config = this.scenarios[scenario];
    if (!config) {
      throw new Error(`Unknown scenario: ${scenario}`);
    }

    const gameId = this.generateGameId();
    const gameState: GameState = {
      gameId,
      config,
      admittedCount: 0,
      rejectedCount: 0,
      currentPersonIndex: 0,
      isFinished: false,
      status: "running"
    };

    this.games.set(gameId, gameState);

    return {
      gameId,
      constraints: config.constraints,
      attributeStatistics: config.attributeStatistics
    };
  }

  /**
   * Makes a decision and gets the next person
   */
  async decideAndNext(gameId: UUID, personIndex: number, accept?: boolean): Promise<DecideAndNextResponse> {
    const fn = "decideAndNext";
    console.log("src/simulation/BerghainSimulator.ts:%s - gameId %s personIndex %d accept %s", fn, gameId, personIndex, String(accept));
    
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error(`Game not found: ${gameId}`);
    }

    if (game.isFinished) {
      throw new Error("Game is already finished");
    }

    // Process the decision for the previous person (if not the first person)
    if (personIndex > 0 && accept !== undefined) {
      if (accept) {
        game.admittedCount++;
      } else {
        game.rejectedCount++;
      }
    }

    // Check end conditions
    if (game.admittedCount >= game.config.venueCapacity) {
      game.isFinished = true;
      game.status = "completed";
      return {
        status: "completed",
        rejectedCount: game.rejectedCount,
        nextPerson: null
      } as DecideAndNextCompleted;
    }

    if (game.rejectedCount >= game.config.maxRejections) {
      game.isFinished = true;
      game.status = "failed";
      return {
        status: "failed",
        reason: "Maximum rejections reached",
        nextPerson: null
      } as DecideAndNextFailed;
    }

    // Generate next person
    const nextPerson = this.generatePerson(game.currentPersonIndex, game.config.attributeStatistics);
    game.currentPersonIndex++;

    return {
      status: "running",
      admittedCount: game.admittedCount,
      rejectedCount: game.rejectedCount,
      nextPerson
    } as DecideAndNextRunning;
  }

  /**
   * Generates a person with attributes based on the provided statistics
   */
  private generatePerson(personIndex: number, stats: AttributeStatistics): Person {
    const attributes: Record<string, boolean> = {};
    
    // Generate attributes based on relative frequencies
    // For now, we'll treat attributes as independent (ignoring correlations for simplicity)
    for (const [attribute, probability] of Object.entries(stats.relativeFrequencies)) {
      attributes[attribute] = Math.random() < probability;
    }

    return {
      personIndex,
      attributes
    };
  }

  /**
   * Generates a unique game ID
   */
  private generateGameId(): UUID {
    return `sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gets the current state of a game (for debugging)
   */
  getGameState(gameId: UUID): GameState | undefined {
    return this.games.get(gameId);
  }

  /**
   * Cleans up finished games to prevent memory leaks
   */
  cleanupFinishedGames(): void {
    const fn = "cleanupFinishedGames";
    let cleaned = 0;
    for (const [gameId, game] of this.games.entries()) {
      if (game.isFinished) {
        this.games.delete(gameId);
        cleaned++;
      }
    }
    console.log("src/simulation/BerghainSimulator.ts:%s - cleaned up %d finished games", fn, cleaned);
  }
}

// File length: 7,421 characters