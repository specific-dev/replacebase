import { describe, it, expect } from "vitest";
import { parseFilter, parseLogicalFilter } from "./filter.js";

describe("Filter Parser", () => {
  it("parses eq filter", () => {
    const result = parseFilter("name", "eq.John");
    expect(result).toEqual({
      type: "filter",
      column: "name",
      operator: "eq",
      value: "John",
      negate: false,
    });
  });

  it("parses neq filter", () => {
    const result = parseFilter("status", "neq.deleted");
    expect(result).toEqual({
      type: "filter",
      column: "status",
      operator: "neq",
      value: "deleted",
      negate: false,
    });
  });

  it("parses negated filter", () => {
    const result = parseFilter("name", "not.eq.John");
    expect(result).toEqual({
      type: "filter",
      column: "name",
      operator: "eq",
      value: "John",
      negate: true,
    });
  });

  it("parses gt filter", () => {
    const result = parseFilter("age", "gt.18");
    expect(result).toMatchObject({ operator: "gt", value: "18" });
  });

  it("parses gte filter", () => {
    const result = parseFilter("age", "gte.21");
    expect(result).toMatchObject({ operator: "gte", value: "21" });
  });

  it("parses lt filter", () => {
    const result = parseFilter("age", "lt.65");
    expect(result).toMatchObject({ operator: "lt", value: "65" });
  });

  it("parses lte filter", () => {
    const result = parseFilter("age", "lte.100");
    expect(result).toMatchObject({ operator: "lte", value: "100" });
  });

  it("parses like filter", () => {
    const result = parseFilter("name", "like.*John*");
    expect(result).toMatchObject({ operator: "like", value: "*John*" });
  });

  it("parses ilike filter", () => {
    const result = parseFilter("name", "ilike.*john*");
    expect(result).toMatchObject({ operator: "ilike", value: "*john*" });
  });

  it("parses in filter", () => {
    const result = parseFilter("id", "in.(1,2,3)");
    expect(result).toMatchObject({ operator: "in", value: "(1,2,3)" });
  });

  it("parses is.null filter", () => {
    const result = parseFilter("deleted_at", "is.null");
    expect(result).toMatchObject({ operator: "is", value: "null" });
  });

  it("parses is.true filter", () => {
    const result = parseFilter("active", "is.true");
    expect(result).toMatchObject({ operator: "is", value: "true" });
  });

  it("parses is.false filter", () => {
    const result = parseFilter("active", "is.false");
    expect(result).toMatchObject({ operator: "is", value: "false" });
  });

  it("parses cs (contains) filter", () => {
    const result = parseFilter("tags", "cs.{a,b}");
    expect(result).toMatchObject({ operator: "cs", value: "{a,b}" });
  });

  it("parses cd (contained by) filter", () => {
    const result = parseFilter("tags", "cd.{a,b,c}");
    expect(result).toMatchObject({ operator: "cd", value: "{a,b,c}" });
  });

  it("parses ov (overlap) filter", () => {
    const result = parseFilter("tags", "ov.{a,b}");
    expect(result).toMatchObject({ operator: "ov", value: "{a,b}" });
  });

  it("parses fts (full-text search) filter", () => {
    const result = parseFilter("body", "fts.hello");
    expect(result).toMatchObject({ operator: "fts", value: "hello" });
  });

  it("throws on unknown operator", () => {
    expect(() => parseFilter("name", "xyz.value")).toThrow("Unknown filter operator");
  });

  it("throws on missing operator", () => {
    expect(() => parseFilter("name", "value")).toThrow("Invalid filter format");
  });
});

describe("Logical Filter Parser", () => {
  it("parses simple or group", () => {
    const result = parseLogicalFilter("or", "(age.gt.18,age.lt.65)");
    expect(result).toMatchObject({
      type: "logical",
      operator: "or",
      negate: false,
    });
    expect(result.conditions).toHaveLength(2);
    expect(result.conditions[0]).toMatchObject({
      column: "age",
      operator: "gt",
      value: "18",
    });
    expect(result.conditions[1]).toMatchObject({
      column: "age",
      operator: "lt",
      value: "65",
    });
  });

  it("parses simple and group", () => {
    const result = parseLogicalFilter("and", "(status.eq.active,role.eq.admin)");
    expect(result).toMatchObject({
      type: "logical",
      operator: "and",
    });
    expect(result.conditions).toHaveLength(2);
  });

  it("parses negated logical filter", () => {
    const result = parseLogicalFilter("or", "(age.gt.18,age.lt.65)", true);
    expect(result.negate).toBe(true);
  });

  it("parses nested logical groups", () => {
    const result = parseLogicalFilter(
      "or",
      "(status.eq.active,and(role.eq.admin,age.gt.21))"
    );
    expect(result.conditions).toHaveLength(2);
    expect(result.conditions[0]).toMatchObject({
      column: "status",
      operator: "eq",
    });
    expect(result.conditions[1]).toMatchObject({
      type: "logical",
      operator: "and",
    });
  });

  it("handles negated conditions inside logical groups", () => {
    const result = parseLogicalFilter(
      "or",
      "(not.status.eq.deleted,age.gt.18)"
    );
    expect(result.conditions[0]).toMatchObject({
      column: "status",
      operator: "eq",
      value: "deleted",
      negate: true,
    });
  });
});
