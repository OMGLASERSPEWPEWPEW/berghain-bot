// File: src/config/defaults.ts (relative to project root)
import * as dotenv from "dotenv";
dotenv.config();

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const config = {
  PLAYER_ID: env("PLAYER_ID", "YOUR-PLAYER-ID-HERE"),
  API_BASE_URL: env("API_BASE_URL", "https://berghain.challenges.listenlabs.ai/api"),
  SCENARIO: Number(env("SCENARIO", "1")),
};
