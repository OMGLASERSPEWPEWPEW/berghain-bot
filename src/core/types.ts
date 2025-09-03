// File: src/core/types.ts (relative to project root)
export type UUID = string;

export interface Constraint {
  attribute: string;  // attributeId
  minCount: number;
}

export interface AttributeStatistics {
  relativeFrequencies: Record<string, number>; // 0.0..1.0
  correlations: Record<string, Record<string, number>>; // -1.0..1.0
}

export interface NewGameResponse {
  gameId: UUID;
  constraints: Constraint[];
  attributeStatistics: AttributeStatistics;
}

export type GameStatus = "running" | "completed" | "failed";

export interface Person {
  personIndex: number;
  attributes: Record<string, boolean>;
}

export interface DecideAndNextRunning {
  status: "running";
  admittedCount: number;
  rejectedCount: number;
  nextPerson: Person;
}

export interface DecideAndNextCompleted {
  status: "completed";
  rejectedCount: number;
  nextPerson: null;
}

export interface DecideAndNextFailed {
  status: "failed";
  reason: string;
  nextPerson: null;
}

export type DecideAndNextResponse =
  | DecideAndNextRunning
  | DecideAndNextCompleted
  | DecideAndNextFailed;

export interface CurrentState {
  admittedCount: number;
  rejectedCount: number;
  admittedAttributes: Record<string, number>; // counts per attributeId
  constraints: Constraint[];
  statistics: AttributeStatistics;
}
