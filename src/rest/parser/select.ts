import type { ParsedSelectItem, ParsedColumn, ParsedEmbedding } from "./types.js";

/**
 * Parse PostgREST select parameter.
 *
 * Examples:
 *   "*"                          → [{ type: "star" }]
 *   "id,name"                    → [{ type: "column", name: "id" }, { type: "column", name: "name" }]
 *   "id,name:full_name"          → [{ type: "column", name: "full_name", alias: "name" }]
 *   "id,posts(id,title)"         → column + embedding
 *   "id,posts!inner(id,title)"   → inner join embedding
 *   "...posts(id,title)"         → spread embedding
 */
export function parseSelect(input: string): ParsedSelectItem[] {
  if (!input || input.trim() === "") {
    return [{ type: "star" }];
  }

  const items: ParsedSelectItem[] = [];
  const tokens = splitTopLevel(input);

  for (const token of tokens) {
    items.push(parseSelectItem(token.trim()));
  }

  return items;
}

/**
 * Split by commas, but not inside parentheses.
 */
function splitTopLevel(input: string): string[] {
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

function parseSelectItem(token: string): ParsedSelectItem {
  if (token === "*") {
    return { type: "star" };
  }

  // Check for spread: ...resource(columns)
  const spread = token.startsWith("...");
  if (spread) {
    token = token.slice(3);
  }

  // Check for embedding: resource(columns) or resource!inner(columns) or resource!hint(columns)
  const parenIdx = token.indexOf("(");
  if (parenIdx !== -1) {
    return parseEmbedding(token, spread);
  }

  if (spread) {
    throw new Error(`Invalid spread syntax: ...${token}`);
  }

  // Check for alias: alias:column
  const colonIdx = token.indexOf(":");
  if (colonIdx !== -1) {
    const beforeColon = token.slice(0, colonIdx);
    const afterColon = token.slice(colonIdx + 1);

    // Check for cast: column::type
    if (afterColon.startsWith(":")) {
      // This is column::type
      const castType = afterColon.slice(1);
      return { type: "column", name: beforeColon, cast: castType };
    }

    // Check if the part after colon has a cast
    const castIdx = afterColon.indexOf("::");
    if (castIdx !== -1) {
      const colName = afterColon.slice(0, castIdx);
      const castType = afterColon.slice(castIdx + 2);
      return { type: "column", name: colName, alias: beforeColon, cast: castType };
    }

    return { type: "column", name: afterColon, alias: beforeColon };
  }

  // Check for cast without alias: column::type
  const castIdx = token.indexOf("::");
  if (castIdx !== -1) {
    const colName = token.slice(0, castIdx);
    const castType = token.slice(castIdx + 2);
    return { type: "column", name: colName, cast: castType };
  }

  return { type: "column", name: token };
}

function parseEmbedding(token: string, spread: boolean): ParsedEmbedding {
  const parenIdx = token.indexOf("(");
  const namePart = token.slice(0, parenIdx);
  const innerContent = token.slice(parenIdx + 1, -1); // Remove wrapping parens

  let name = namePart;
  let alias: string | undefined;
  let hint: string | undefined;
  let inner = false;

  // Check for alias: alias:resource
  const colonIdx = name.indexOf(":");
  if (colonIdx !== -1) {
    alias = name.slice(0, colonIdx);
    name = name.slice(colonIdx + 1);
  }

  // Check for hint/inner: resource!hint or resource!inner or resource!hint!inner
  const exclamationParts = name.split("!");
  name = exclamationParts[0];
  for (let i = 1; i < exclamationParts.length; i++) {
    if (exclamationParts[i] === "inner") {
      inner = true;
    } else {
      hint = exclamationParts[i];
    }
  }

  const columns = innerContent ? parseSelect(innerContent) : [{ type: "star" as const }];

  return {
    type: "embedding",
    name,
    alias,
    hint,
    inner,
    spread,
    columns,
  };
}
