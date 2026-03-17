import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { SchemaRegistry } from "./schema-registry";
import type { ForeignKeyMeta } from "./schema-registry";
import type { IntrospectedFunction } from "./introspect";
import { QueryBuilder } from "./query-builder";
import { parseSelect } from "./parser/select";
import { parseFilter, parseLogicalFilter } from "./parser/filter";
import { parseOrder } from "./parser/order";
import { parsePagination } from "./parser/pagination";
import { parsePrefer } from "./parser/prefer";
import type { FilterNode } from "./parser/types";
import { formatSelectResponse, formatMutationResponse } from "./response";
import { withRLS } from "./rls";
import type { RLSContext } from "./rls";

export function createRestRouter(
  db: PgDatabase<any, any, any>,
  schema: Record<string, unknown>,
  foreignKeys?: Map<string, ForeignKeyMeta[]>,
  views?: Set<string>,
  functions?: Map<string, IntrospectedFunction>
): Hono {
  const app = new Hono();
  const registry = new SchemaRegistry(schema, foreignKeys, views);
  const functionCatalog = functions ?? new Map<string, IntrospectedFunction>();

  // RPC handler shared by POST, GET, and HEAD
  const handleRpc = async (c: any, method: "POST" | "GET" | "HEAD") => {
    const functionName = c.req.param("function_name");
    const url = new URL(c.req.url);
    const params = url.searchParams;
    const prefer = parsePrefer(c.req.header("Prefer") || null);
    const acceptHeader = c.req.header("Accept") || null;

    // Validate function name against the introspected catalog
    const fnMeta = functionCatalog.get(functionName);
    if (!fnMeta) {
      return c.json(
        {
          message: `Function ${functionName} does not exist or is not accessible`,
          code: "PGRST202",
          details: null,
          hint: null,
        },
        404
      );
    }

    // Parse function arguments
    let args: Record<string, any> = {};
    if (method === "POST") {
      args = await c.req.json().catch(() => ({}));
    } else {
      // GET/HEAD: args come from query params (excluding PostgREST reserved params)
      const reservedRpcParams = new Set(["select", "order", "limit", "offset"]);
      for (const [key, value] of params.entries()) {
        if (reservedRpcParams.has(key)) continue;
        if (isFilterParam(key)) continue;
        args[key] = value;
      }
    }

    // Validate parameter names against the function's known input params
    if (fnMeta.inputParams.length > 0) {
      const knownParams = new Set(fnMeta.inputParams);
      for (const paramName of Object.keys(args)) {
        if (!knownParams.has(paramName)) {
          return c.json(
            {
              message: `Function ${functionName} does not have a parameter named ${paramName}`,
              code: "PGRST202",
              details: null,
              hint: null,
            },
            400
          );
        }
      }
    }

    // Parse query modifiers (select, filters, order, pagination)
    const selectParam = params.get("select") || "";
    const orderParam = params.get("order") || "";
    const order = parseOrder(orderParam);
    const pagination = parsePagination(params, c.req.header("Range") || null);
    const filters = extractRpcFilters(params);

    // Validate column references in select, filter, and order against return columns
    const knownColumns = fnMeta.returnColumns.length > 0
      ? new Set(fnMeta.returnColumns)
      : null;

    if (knownColumns) {
      // Validate select columns
      if (selectParam) {
        for (const col of selectParam.split(",").map((c: string) => c.trim())) {
          if (!knownColumns.has(col)) {
            return c.json(
              {
                message: `Column ${col} is not present in the return type of function ${functionName}`,
                code: "PGRST204",
                details: null,
                hint: null,
              },
              400
            );
          }
        }
      }

      // Validate filter columns
      for (const filter of filters) {
        const invalidCol = findInvalidFilterColumn(filter, knownColumns);
        if (invalidCol) {
          return c.json(
            {
              message: `Column ${invalidCol} is not present in the return type of function ${functionName}`,
              code: "PGRST204",
              details: null,
              hint: null,
            },
            400
          );
        }
      }

      // Validate order columns
      for (const item of order) {
        if (!knownColumns.has(item.column)) {
          return c.json(
            {
              message: `Column ${item.column} is not present in the return type of function ${functionName}`,
              code: "PGRST204",
              details: null,
              hint: null,
            },
            400
          );
        }
      }
    }

    const rlsContext = getRLSContext(c);

    try {
      const rawResult = await withRLS(db, rlsContext, async (tx) => {
        return await executeRpcQuery(tx, functionName, args, {
          select: selectParam,
          filters,
          order,
          pagination,
          prefer,
        });
      });

      // Normalize: PGlite returns { rows }, postgres.js returns array directly
      const rows = Array.isArray(rawResult) ? rawResult : rawResult.rows || [];

      // Void function: no columns returned
      if (rows.length === 0 || (rows.length > 0 && Object.keys(rows[0]).length === 0)) {
        if (method === "HEAD") {
          return c.body(null, 200);
        }
        // For void functions, return empty body
        if (rows.length > 0 && Object.keys(rows[0]).length === 0) {
          return c.body(null, 204);
        }
      }

      // Check if this is a scalar result (single row, single column named after function)
      const isScalar = rows.length === 1 &&
        Object.keys(rows[0]).length === 1 &&
        Object.keys(rows[0])[0] === functionName &&
        filters.length === 0 && !orderParam && !selectParam;

      if (isScalar) {
        if (method === "HEAD") {
          return c.body(null, 200);
        }
        return c.json(rows[0][functionName], 200);
      }

      // Set-returning function: apply response formatting
      const totalCount = prefer.count === "exact" ? rows.length : undefined;

      if (method === "HEAD") {
        const response = c.body(null, 200);
        if (totalCount !== undefined) {
          response.headers.set("Content-Range", `0-0/${totalCount}`);
          response.headers.set("Range-Unit", "items");
        }
        return response;
      }

      // CSV response
      if (acceptHeader === "text/csv") {
        if (rows.length === 0) {
          return new Response("", { status: 200, headers: { "Content-Type": "text/csv" } });
        }
        const columns = Object.keys(rows[0]);
        const csvLines = [columns.join(",")];
        for (const row of rows) {
          csvLines.push(columns.map((col) => formatCsvValue(row[col])).join(","));
        }
        return new Response(csvLines.join("\n"), {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        });
      }

      // Single object response
      if (acceptHeader === "application/vnd.pgrst.object+json") {
        if (rows.length !== 1) {
          return c.json(
            {
              message: "JSON object requested, multiple (or no) rows returned",
              details: `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
              code: "PGRST116",
              hint: null,
            },
            406
          );
        }
        const response = c.json(rows[0], 200);
        if (totalCount !== undefined) {
          response.headers.set("Content-Range", `0-0/${totalCount}`);
        }
        return response;
      }

      // Default: array response
      const response = c.json(rows, 200);
      if (totalCount !== undefined) {
        const end = rows.length > 0 ? rows.length - 1 : 0;
        response.headers.set("Content-Range", `0-${end}/${totalCount}`);
        response.headers.set("Range-Unit", "items");
      }
      return response;
    } catch (error: any) {
      const status = error.message.includes("not found") || error.message.includes("does not exist") ? 404 : 400;
      return c.json({ message: error.message, code: "PGRST000" }, status);
    }
  };

  app.post("/rpc/:function_name", (c) => handleRpc(c, "POST"));
  app.get("/rpc/:function_name", (c) => handleRpc(c, "GET"));
  app.on("HEAD", ["/rpc/:function_name"], (c) => handleRpc(c, "HEAD"));

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

/**
 * Safely quote a SQL identifier, matching PostgreSQL's quote_ident() behavior.
 * Doubles any embedded double-quote characters and wraps in double quotes.
 */
function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Recursively find the first column name in a filter tree that isn't in the allowed set */
function findInvalidFilterColumn(node: FilterNode, allowed: Set<string>): string | null {
  if (node.type === "logical") {
    for (const child of node.conditions) {
      const invalid = findInvalidFilterColumn(child, allowed);
      if (invalid) return invalid;
    }
    return null;
  }
  return allowed.has(node.column) ? null : node.column;
}

/** Check if a query param key looks like a PostgREST filter (e.g. "column=eq.value") */
function isFilterParam(key: string): boolean {
  // Logical operators
  if (key === "or" || key === "and" || key === "not.or" || key === "not.and") return true;
  // Regular filter params don't contain dots in the key itself in PostgREST -
  // the filter value contains the operator. But for GET RPC, we need to distinguish
  // function args from filters. Filters have values like "eq.X", "gt.X", etc.
  return false;
}

/** Extract filters from query params for RPC, distinguishing them from function args for GET */
function extractRpcFilters(params: URLSearchParams): FilterNode[] {
  const filters: FilterNode[] = [];
  const reservedParams = new Set([
    "select",
    "order",
    "limit",
    "offset",
  ]);

  for (const [key, value] of params.entries()) {
    if (reservedParams.has(key)) continue;

    // Handle logical operators: or=(...), and=(...)
    if (key === "or" || key === "and") {
      filters.push(parseLogicalFilter(key, value, false));
      continue;
    }

    if (key === "not.or" || key === "not.and") {
      const op = key.slice(4) as "or" | "and";
      filters.push(parseLogicalFilter(op, value, true));
      continue;
    }

    // Check if value looks like a PostgREST filter (operator.value pattern)
    const filterOps = /^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|match|imatch|in|is|isdistinct|cs|cd|sl|sr|nxl|nxr|adj|ov|fts|plfts|phfts|wfts)\./;
    if (filterOps.test(value)) {
      filters.push(parseFilter(key, value));
    }
  }

  return filters;
}

interface RpcQueryOptions {
  select: string;
  filters: FilterNode[];
  order: import("./parser/types").OrderItem[];
  pagination: import("./parser/types").PaginationParams;
  prefer: import("./parser/types").PreferParams;
}

/** Execute an RPC function call with optional query modifiers */
async function executeRpcQuery(
  tx: any,
  functionName: string,
  args: Record<string, any>,
  options: RpcQueryOptions
): Promise<any> {
  const hasModifiers = options.select ||
    options.filters.length > 0 ||
    options.order.length > 0 ||
    options.pagination.limit !== undefined ||
    options.pagination.offset !== undefined;

  // Build function call SQL using safe identifier quoting
  const paramNames = Object.keys(args);
  const paramValues = Object.values(args);

  let functionCallSql: any;
  if (paramNames.length === 0) {
    functionCallSql = sql.raw(`${quoteIdent(functionName)}()`);
  } else {
    const parts: any[] = [];
    parts.push(sql.raw(`${quoteIdent(functionName)}(`));
    for (let i = 0; i < paramNames.length; i++) {
      if (i > 0) parts.push(sql.raw(`, `));
      parts.push(sql.raw(`${quoteIdent(paramNames[i])} := `));
      parts.push(sql`${paramValues[i]}`);
    }
    parts.push(sql.raw(`)`));
    functionCallSql = sql.join(parts, sql.raw(""));
  }

  if (!hasModifiers) {
    // Simple case: no modifiers, just execute the function
    const query = sql.join([sql.raw("SELECT * FROM "), functionCallSql], sql.raw(""));
    return await tx.execute(query);
  }

  // Build wrapped query: SELECT [columns] FROM (SELECT * FROM fn(args)) AS _rpc_result [WHERE] [ORDER] [LIMIT] [OFFSET]
  const queryParts: any[] = [];

  // SELECT clause
  if (options.select) {
    const columns = options.select.split(",").map((c: string) => c.trim());
    const selectList = columns.map((col: string) => quoteIdent(col)).join(", ");
    queryParts.push(sql.raw(`SELECT ${selectList} FROM (`));
  } else {
    queryParts.push(sql.raw(`SELECT * FROM (`));
  }

  queryParts.push(sql.raw("SELECT * FROM "));
  queryParts.push(functionCallSql);
  queryParts.push(sql.raw(`) AS _rpc_result`));

  // WHERE clause from filters
  if (options.filters.length > 0) {
    const whereParts = options.filters.map((f) => filterNodeToSql(f));
    queryParts.push(sql.raw(` WHERE `));
    for (let i = 0; i < whereParts.length; i++) {
      if (i > 0) queryParts.push(sql.raw(` AND `));
      queryParts.push(whereParts[i]);
    }
  }

  // ORDER BY clause
  if (options.order.length > 0) {
    queryParts.push(sql.raw(` ORDER BY `));
    for (let i = 0; i < options.order.length; i++) {
      if (i > 0) queryParts.push(sql.raw(`, `));
      const item = options.order[i];
      queryParts.push(sql.raw(`${quoteIdent(item.column)} ${item.direction}`));
      if (item.nulls) {
        queryParts.push(sql.raw(` NULLS ${item.nulls === "first" ? "FIRST" : "LAST"}`));
      }
    }
  }

  // LIMIT / OFFSET (safe: these are parsed integers from parsePagination)
  if (options.pagination.limit !== undefined) {
    queryParts.push(sql` LIMIT ${options.pagination.limit}`);
  }
  if (options.pagination.offset !== undefined) {
    queryParts.push(sql` OFFSET ${options.pagination.offset}`);
  }

  const query = sql.join(queryParts, sql.raw(""));
  return await tx.execute(query);
}

/** Convert a FilterNode to a parameterized Drizzle SQL fragment */
function filterNodeToSql(node: FilterNode): any {
  if (node.type === "logical") {
    const joiner = node.operator === "or" ? " OR " : " AND ";
    const conditions = node.conditions.map((c) => filterNodeToSql(c));
    const joined = sql.join(
      [sql.raw("("), ...conditions.flatMap((c, i) =>
        i > 0 ? [sql.raw(joiner), c] : [c]
      ), sql.raw(")")],
      sql.raw("")
    );
    if (node.negate) {
      return sql.join([sql.raw("NOT "), joined], sql.raw(""));
    }
    return joined;
  }

  const { column, operator, value, negate } = node;
  const prefix = negate ? "NOT " : "";
  const colRef = sql.raw(`${prefix}${quoteIdent(column)}`);
  // Parse the value to a native JS type for proper parameterization
  const typedValue = parseFilterValue(value);

  switch (operator) {
    case "eq":
      return sql`${colRef} = ${typedValue}`;
    case "neq":
      return sql`${colRef} != ${typedValue}`;
    case "gt":
      return sql`${colRef} > ${typedValue}`;
    case "gte":
      return sql`${colRef} >= ${typedValue}`;
    case "lt":
      return sql`${colRef} < ${typedValue}`;
    case "lte":
      return sql`${colRef} <= ${typedValue}`;
    case "like":
      return sql`${colRef} LIKE ${typedValue}`;
    case "ilike":
      return sql`${colRef} ILIKE ${typedValue}`;
    case "is":
      // IS operator uses SQL keywords, not parameterized values
      if (value === "null") return sql.join([colRef, sql.raw(` IS NULL`)], sql.raw(""));
      if (value === "true") return sql.join([colRef, sql.raw(` IS TRUE`)], sql.raw(""));
      if (value === "false") return sql.join([colRef, sql.raw(` IS FALSE`)], sql.raw(""));
      return sql.join([colRef, sql.raw(` IS NULL`)], sql.raw(""));
    case "in": {
      // value is like "(val1,val2,val3)" - parse and parameterize each value
      const inner = value.replace(/^\(/, "").replace(/\)$/, "");
      const vals = inner.split(",").map((v) => parseFilterValue(v.trim()));
      const placeholders = vals.map((v) => sql`${v}`);
      const inList = sql.join(placeholders, sql.raw(", "));
      return sql.join([colRef, sql.raw(` IN (`), inList, sql.raw(`)`)], sql.raw(""));
    }
    default:
      return sql`${colRef} = ${typedValue}`;
  }
}

/** Parse a PostgREST filter value string into a native JS type for parameterization */
function parseFilterValue(value: string): string | number | boolean | null {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  // Try numeric
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  // Remove surrounding quotes if present
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** Format a value for CSV output */
function formatCsvValue(value: any): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
