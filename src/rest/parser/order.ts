import type { OrderItem } from "./types.js";

/**
 * Parse PostgREST order parameter.
 *
 * Format: column.direction.nulls,column.direction.nulls,...
 *
 * Examples:
 *   "name"                  → [{ column: "name", direction: "asc" }]
 *   "name.desc"             → [{ column: "name", direction: "desc" }]
 *   "name.asc.nullsfirst"   → [{ column: "name", direction: "asc", nulls: "first" }]
 *   "name.desc,id.asc"      → two items
 */
export function parseOrder(input: string): OrderItem[] {
  if (!input || input.trim() === "") {
    return [];
  }

  return input.split(",").map((part) => {
    const segments = part.trim().split(".");
    const column = segments[0];
    let direction: "asc" | "desc" = "asc";
    let nulls: "first" | "last" | undefined;

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i].toLowerCase();
      if (seg === "asc" || seg === "desc") {
        direction = seg;
      } else if (seg === "nullsfirst") {
        nulls = "first";
      } else if (seg === "nullslast") {
        nulls = "last";
      }
    }

    return { column, direction, nulls };
  });
}
