import { Hono } from "hono";
import { sql } from "drizzle-orm";
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

  // POST /rpc/:function_name - RPC call
  app.post("/rpc/:function_name", async (c) => {
    const functionName = c.req.param("function_name");
    const body = await c.req.json().catch(() => ({}));

    const rlsContext = getRLSContext(c);

    try {
      const rawResult = await withRLS(db, rlsContext, async (tx) => {
        // Build parameter list for the function call
        const paramNames = Object.keys(body);
        const paramValues = Object.values(body);

        if (paramNames.length === 0) {
          return await (tx as any).execute(
            sql.raw(`SELECT * FROM "${functionName}"()`)
          );
        }

        // Build parameterized SQL: SELECT * FROM function_name(param1 := $1, param2 := $2, ...)
        const parts: any[] = [];
        parts.push(sql.raw(`SELECT * FROM "${functionName}"(`));
        for (let i = 0; i < paramNames.length; i++) {
          if (i > 0) parts.push(sql.raw(`, `));
          parts.push(sql.raw(`"${paramNames[i]}" := `));
          parts.push(sql`${paramValues[i]}`);
        }
        parts.push(sql.raw(`)`));

        const query = sql.join(parts, sql.raw(""));
        return await (tx as any).execute(query);
      });

      // Normalize: PGlite returns { rows }, postgres.js returns array directly
      const rows = Array.isArray(rawResult) ? rawResult : rawResult.rows || [];

      // If result is a single row with a single column named after the function,
      // return the scalar value (PostgREST convention)
      if (rows.length === 1) {
        const keys = Object.keys(rows[0]);
        if (keys.length === 1 && keys[0] === functionName) {
          return c.json(rows[0][functionName], 200);
        }
      }

      return c.json(rows, 200);
    } catch (error: any) {
      return c.json(
        { message: error.message, code: "PGRST000" },
        error.message.includes("not found") || error.message.includes("does not exist") ? 404 : 400
      );
    }
  });

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

      const count = prefer.count === "exact" ? result.length : undefined;
      return formatMutationResponse(c, result, prefer, "POST", count);
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

      const count = prefer.count === "exact" ? result.length : undefined;
      return formatMutationResponse(c, result, prefer, "PATCH", count);
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

      const count = prefer.count === "exact" ? result.length : undefined;
      return formatMutationResponse(c, result, prefer, "DELETE", count);
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
