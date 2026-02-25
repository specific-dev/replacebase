import type { PaginationParams } from "./types";

/**
 * Parse pagination from query params and Range header.
 *
 * Query params: limit, offset
 * Range header: "0-9" (inclusive range, converted to limit/offset)
 */
export function parsePagination(
  params: URLSearchParams,
  rangeHeader: string | null
): PaginationParams {
  const result: PaginationParams = {};

  const limit = params.get("limit");
  if (limit !== null) {
    result.limit = parseInt(limit, 10);
  }

  const offset = params.get("offset");
  if (offset !== null) {
    result.offset = parseInt(offset, 10);
  }

  // Range header takes precedence
  if (rangeHeader) {
    const match = rangeHeader.match(/^(\d+)-(\d+)$/);
    if (match) {
      result.rangeStart = parseInt(match[1], 10);
      result.rangeEnd = parseInt(match[2], 10);
      result.offset = result.rangeStart;
      result.limit = result.rangeEnd - result.rangeStart + 1;
    }
  }

  return result;
}
