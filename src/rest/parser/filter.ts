import type { FilterNode, FilterCondition, LogicalFilter, FilterOperator } from "./types";

const OPERATORS = new Set<string>([
  "eq", "neq", "gt", "gte", "lt", "lte",
  "like", "ilike", "match", "imatch",
  "in", "is", "isdistinct",
  "cs", "cd", "sl", "sr", "nxl", "nxr", "adj", "ov",
  "fts", "plfts", "phfts", "wfts",
]);

/**
 * Parse a PostgREST filter value.
 *
 * Format: [not.]operator.value
 *
 * Examples:
 *   "eq.hello"           → { column, operator: "eq", value: "hello", negate: false }
 *   "not.eq.hello"       → { column, operator: "eq", value: "hello", negate: true }
 *   "in.(1,2,3)"         → { column, operator: "in", value: "(1,2,3)", negate: false }
 *   "is.null"            → { column, operator: "is", value: "null", negate: false }
 */
export function parseFilter(column: string, value: string): FilterNode {
  return parseFilterValue(column, value);
}

function parseFilterValue(column: string, value: string): FilterCondition {
  let negate = false;

  // Check for not. prefix
  if (value.startsWith("not.")) {
    negate = true;
    value = value.slice(4);
  }

  // Find the operator
  const dotIdx = value.indexOf(".");
  if (dotIdx === -1) {
    throw new Error(`Invalid filter format: ${value}`);
  }

  const operator = value.slice(0, dotIdx);
  const operand = value.slice(dotIdx + 1);

  if (!OPERATORS.has(operator)) {
    throw new Error(`Unknown filter operator: ${operator}`);
  }

  return {
    type: "filter",
    column,
    operator: operator as FilterOperator,
    value: operand,
    negate,
  };
}

/**
 * Parse logical filter groups: or=(...) and and=(...)
 *
 * Examples:
 *   "or"  "(age.gt.18,age.lt.65)"   → LogicalFilter with two conditions
 *   "and" "(status.eq.active,role.eq.admin)" → LogicalFilter
 */
export function parseLogicalFilter(
  operator: "or" | "and",
  value: string,
  negate: boolean = false
): LogicalFilter {
  // Remove wrapping parens
  let inner = value;
  if (inner.startsWith("(") && inner.endsWith(")")) {
    inner = inner.slice(1, -1);
  }

  const parts = splitLogicalParts(inner);
  const conditions: FilterNode[] = [];

  for (const part of parts) {
    // Each part is "column.operator.value" or "not.column.operator.value"
    // or another logical group like "or(column.operator.value,...)"
    const parsed = parseLogicalPart(part.trim());
    conditions.push(parsed);
  }

  return {
    type: "logical",
    operator,
    negate,
    conditions,
  };
}

function parseLogicalPart(part: string): FilterNode {
  let negate = false;
  if (part.startsWith("not.")) {
    negate = true;
    part = part.slice(4);
  }

  // Check for nested logical: or(...) or and(...)
  if (part.startsWith("or(") || part.startsWith("and(")) {
    const op = part.startsWith("or(") ? "or" : "and";
    const inner = part.slice(op.length);
    return parseLogicalFilter(op, inner, negate);
  }

  // Regular filter: column.operator.value
  const dotIdx = part.indexOf(".");
  if (dotIdx === -1) {
    throw new Error(`Invalid filter part: ${part}`);
  }

  const column = part.slice(0, dotIdx);
  const rest = part.slice(dotIdx + 1);

  const condition = parseFilterValue(column, rest);
  if (negate) {
    condition.negate = !condition.negate;
  }
  return condition;
}

/**
 * Split by commas, but not inside parentheses.
 */
function splitLogicalParts(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of input) {
    if (char === "(") {
      depth++;
      current += char;
    } else if (char === ")") {
      depth--;
      current += char;
    } else if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}
