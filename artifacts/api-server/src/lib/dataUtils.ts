/**
 * Shared data-layer utilities.
 * Used by both botAdmin routes and the health-check worker.
 */
import fs from "fs";
import path from "path";

export const DATA_DIR =
  process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");

export function dataFile(name: string) {
  return path.join(DATA_DIR, `${name}.json`);
}

export function readJson(name: string, fallback: unknown = null): any {
  const file = dataFile(name);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, data: unknown) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = dataFile(name);
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, dataFile(name + ".bak"));
    } catch {}
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

export function now(): string {
  return new Date().toISOString();
}
