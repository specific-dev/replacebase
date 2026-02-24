import type { PreferParams } from "./types.js";

/**
 * Parse the Prefer header used by PostgREST.
 *
 * Examples:
 *   "return=representation"                → { return: "representation" }
 *   "return=minimal, count=exact"          → { return: "minimal", count: "exact" }
 *   "resolution=merge-duplicates"          → { resolution: "merge-duplicates" }
 *   "missing=default"                      → { missing: "default" }
 */
export function parsePrefer(header: string | null): PreferParams {
  if (!header) {
    return {};
  }

  const result: PreferParams = {};
  const parts = header.split(",");

  for (const part of parts) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    switch (key) {
      case "return":
        if (value === "representation" || value === "minimal" || value === "headers-only") {
          result.return = value;
        }
        break;
      case "count":
        if (value === "exact" || value === "planned" || value === "estimated") {
          result.count = value;
        }
        break;
      case "resolution":
        if (value === "merge-duplicates" || value === "ignore-duplicates") {
          result.resolution = value;
        }
        break;
      case "missing":
        if (value === "default" || value === "null") {
          result.missing = value;
        }
        break;
    }
  }

  return result;
}
