import { Hono } from "hono";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { SchemaRegistry } from "./schema-registry.js";
import { QueryBuilder } from "./query-builder.js";
import { parseSelect } from "./parser/select.js";
import { parseFilter, parseLogicalFilter } from "./parser/filter.js";
import { parseOrder } from "./parser/order.js";
import { parsePagination } from "./parser/pagination.js";
import { parsePrefer } from "./parser/prefer.js";
import type { FilterNode } from "./parser/types.js";
import { formatSelectResponse, formatMutationResponse } from "./response.js";
import { withRLS } from "./rls.js";
import type { RLSContext } from "./rls.js";

export function createRestRouter(
  db: PgDatabase<any, any, any>,
  schema: Record<string, unknown>
): Hono {
  const app = new Hono();
  const registry = new SchemaRegistry(schema);

  // GET /:table - Select
  app.get("/:table", async (c) => {
    const tableName = c.req.param("table");
    const url = new URL(c.req.url);
    const params = url.searchParams;

    const select = parseSelect(params.get("select") || "");
    const order = parseOrder(params.get("order") || "");
    const pagination = parsePagination(params, c.req.header("Range") || null);
    const prefer = parsePrefer(c.req.header("Prefer") || null);

    // Extract filters from query params
    const filters = extractFilters(params);

    const rlsContext = getRLSContext(c);
    const queryBuilder = new QueryBuilder(registry, db);

    try {
      const result = await withRLS(db, rlsContext, async (tx) => {
        const txBuilder = new QueryBuilder(registry, tx);
        return await txBuilder.executeSelect({
          table: tableName,
          select,
          filters,
          order,
          pagination,
          prefer,
        });
      });

      return formatSelectResponse(
        c,
        result,
        prefer,
        c.req.header("Accept") || null
      );
    } catch (error: any) {
      return c.json(
        { message: error.message, code: "PGRST000" },
        error.message.includes("not found") ? 404 : 400
      );
    }
  });

  // POST /:table - Insert
  app.post("/:table", async (c) => {
    const tableName = c.req.param("table");
    const body = await c.req.json();
    const prefer = parsePrefer(c.req.header("Prefer") || null);
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const onConflict = params.get("on_conflict") || undefined;
    const columns = params.get("columns") || undefined;

    const rlsContext = getRLSContext(c);
    const queryBuilder = new QueryBuilder(registry, db);

    try {
      const result = await withRLS(db, rlsContext, async (tx) => {
        const txBuilder = new QueryBuilder(registry, tx);
        return await txBuilder.executeInsert({
          table: tableName,
          filters: [],
          prefer,
          body,
          onConflict,
          columns,
        });
      });

      return formatMutationResponse(c, result, prefer, "POST");
    } catch (error: any) {
      return c.json({ message: error.message, code: "PGRST000" }, 400);
    }
  });

  // PATCH /:table - Update
  app.patch("/:table", async (c) => {
    const tableName = c.req.param("table");
    const body = await c.req.json();
    const prefer = parsePrefer(c.req.header("Prefer") || null);
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const filters = extractFilters(params);

    const rlsContext = getRLSContext(c);

    try {
      const result = await withRLS(db, rlsContext, async (tx) => {
        const txBuilder = new QueryBuilder(registry, tx);
        return await txBuilder.executeUpdate({
          table: tableName,
          filters,
          prefer,
          body,
        });
      });

      return formatMutationResponse(c, result, prefer, "PATCH");
    } catch (error: any) {
      return c.json({ message: error.message, code: "PGRST000" }, 400);
    }
  });

  // DELETE /:table - Delete
  app.delete("/:table", async (c) => {
    const tableName = c.req.param("table");
    const prefer = parsePrefer(c.req.header("Prefer") || null);
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const filters = extractFilters(params);

    const rlsContext = getRLSContext(c);

    try {
      const result = await withRLS(db, rlsContext, async (tx) => {
        const txBuilder = new QueryBuilder(registry, tx);
        return await txBuilder.executeDelete({
          table: tableName,
          filters,
          prefer,
          body: {},
        });
      });

      return formatMutationResponse(c, result, prefer, "DELETE");
    } catch (error: any) {
      return c.json({ message: error.message, code: "PGRST000" }, 400);
    }
  });

  return app;
}

function extractFilters(params: URLSearchParams): FilterNode[] {
  const filters: FilterNode[] = [];
  const reservedParams = new Set([
    "select",
    "order",
    "limit",
    "offset",
    "on_conflict",
    "columns",
  ]);

  for (const [key, value] of params.entries()) {
    if (reservedParams.has(key)) continue;

    // Handle logical operators: or=(...), and=(...)
    if (key === "or" || key === "and") {
      const negate = false;
      filters.push(parseLogicalFilter(key, value, negate));
      continue;
    }

    if (key === "not.or" || key === "not.and") {
      const op = key.slice(4) as "or" | "and";
      filters.push(parseLogicalFilter(op, value, true));
      continue;
    }

    // Regular column filter
    filters.push(parseFilter(key, value));
  }

  return filters;
}

function getRLSContext(c: any): RLSContext {
  // Get from Hono context (set by API key middleware)
  return {
    role: c.get?.("role") || "anon",
    claims: c.get?.("claims") || null,
    userId: c.get?.("userId") || null,
  };
}
