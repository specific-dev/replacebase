// AST types for PostgREST query parsing

export interface ParsedColumn {
  type: "column";
  name: string;
  alias?: string;
  cast?: string;
}

export interface ParsedStar {
  type: "star";
}

export interface ParsedEmbedding {
  type: "embedding";
  name: string;
  alias?: string;
  hint?: string;
  inner: boolean;
  spread: boolean;
  columns: ParsedSelectItem[];
}

export type ParsedSelectItem = ParsedColumn | ParsedStar | ParsedEmbedding;

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "match"
  | "imatch"
  | "in"
  | "is"
  | "isdistinct"
  | "cs"
  | "cd"
  | "sl"
  | "sr"
  | "nxl"
  | "nxr"
  | "adj"
  | "ov"
  | "fts"
  | "plfts"
  | "phfts"
  | "wfts";

export interface FilterCondition {
  type: "filter";
  column: string;
  operator: FilterOperator;
  value: string;
  negate: boolean;
}

export interface LogicalFilter {
  type: "logical";
  operator: "or" | "and";
  negate: boolean;
  conditions: FilterNode[];
}

export type FilterNode = FilterCondition | LogicalFilter;

export interface OrderItem {
  column: string;
  direction: "asc" | "desc";
  nulls?: "first" | "last";
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
  rangeStart?: number;
  rangeEnd?: number;
}

export interface PreferParams {
  return?: "representation" | "minimal" | "headers-only";
  count?: "exact" | "planned" | "estimated";
  resolution?: "merge-duplicates" | "ignore-duplicates";
  missing?: "default" | "null";
}
