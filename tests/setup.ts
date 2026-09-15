import fs from "node:fs";
import path from "node:path";

/**
 * Vitest does not load .env files the way `next dev` does, so this does it
 * by hand - the same parsing every scratch verification script this project
 * has used all along, just no longer thrown away after one run.
 */
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
    const value = trimmed.slice(trimmed.indexOf("=") + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
