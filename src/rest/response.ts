import type { Context } from "hono";
import type { QueryResult } from "./query-builder.js";
import type { PreferParams } from "./parser/types.js";

export function formatSelectResponse(
  c: Context,
  result: QueryResult,
  prefer: PreferParams,
  acceptHeader: string | null
): Response {
  // Single object response
  if (acceptHeader === "application/vnd.pgrst.object+json") {
    if (result.data.length === 0) {
      return c.json(
        { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
        406
      );
    }
    if (result.data.length > 1) {
      return c.json(
        { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
        406
      );
    }

    const response = c.json(result.data[0], 200);
    if (result.totalCount !== undefined) {
      response.headers.set(
        "Content-Range",
        `0-0/${result.totalCount}`
      );
    }
    return response;
  }

  // Array response (default)
  const status = 200;
  const response = c.json(result.data, status);

  if (result.totalCount !== undefined) {
    const end = result.data.length > 0 ? result.data.length - 1 : 0;
    response.headers.set(
      "Content-Range",
      `0-${end}/${result.totalCount}`
    );
    response.headers.set("Range-Unit", "items");
  }

  return response;
}

export function formatMutationResponse(
  c: Context,
  data: any[],
  prefer: PreferParams,
  method: "POST" | "PATCH" | "DELETE",
  count?: number
): Response {
  if (prefer.return === "representation") {
    const status = method === "POST" ? 201 : 200;
    const response = c.json(data, status);
    if (count !== undefined) {
      const end = data.length > 0 ? data.length - 1 : 0;
      response.headers.set("Content-Range", `*/${count}`);
    }
    return response;
  }

  // Minimal or no preference
  const status = method === "POST" ? 201 : 204;
  const response = c.body(null, status);
  if (count !== undefined) {
    response.headers.set("Content-Range", `*/${count}`);
  }
  return response;
}
