import { describe, it, expect } from "vitest";
import { parseSelect } from "./select";

describe("Select Parser", () => {
  it("parses empty string as star", () => {
    expect(parseSelect("")).toEqual([{ type: "star" }]);
  });

  it("parses star", () => {
    expect(parseSelect("*")).toEqual([{ type: "star" }]);
  });

  it("parses single column", () => {
    expect(parseSelect("id")).toEqual([{ type: "column", name: "id" }]);
  });

  it("parses multiple columns", () => {
    const result = parseSelect("id,name,email");
    expect(result).toEqual([
      { type: "column", name: "id" },
      { type: "column", name: "name" },
      { type: "column", name: "email" },
    ]);
  });

  it("parses column alias", () => {
    const result = parseSelect("full_name:name");
    expect(result).toEqual([
      { type: "column", name: "name", alias: "full_name" },
    ]);
  });

  it("parses column cast", () => {
    const result = parseSelect("age::integer");
    expect(result).toEqual([
      { type: "column", name: "age", cast: "integer" },
    ]);
  });

  it("parses column with alias and cast", () => {
    const result = parseSelect("my_age:age::integer");
    expect(result).toEqual([
      { type: "column", name: "age", alias: "my_age", cast: "integer" },
    ]);
  });

  it("parses simple embedding", () => {
    const result = parseSelect("id,posts(id,title)");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "column", name: "id" });
    expect(result[1]).toEqual({
      type: "embedding",
      name: "posts",
      alias: undefined,
      hint: undefined,
      inner: false,
      spread: false,
      columns: [
        { type: "column", name: "id" },
        { type: "column", name: "title" },
      ],
    });
  });

  it("parses inner join embedding", () => {
    const result = parseSelect("id,posts!inner(id,title)");
    expect(result[1]).toMatchObject({
      type: "embedding",
      name: "posts",
      inner: true,
    });
  });

  it("parses embedding with hint", () => {
    const result = parseSelect("id,posts!fk_author(id,title)");
    expect(result[1]).toMatchObject({
      type: "embedding",
      name: "posts",
      hint: "fk_author",
      inner: false,
    });
  });

  it("parses embedding with hint and inner", () => {
    const result = parseSelect("id,posts!fk_author!inner(id,title)");
    expect(result[1]).toMatchObject({
      type: "embedding",
      name: "posts",
      hint: "fk_author",
      inner: true,
    });
  });

  it("parses spread embedding", () => {
    const result = parseSelect("id,...posts(id,title)");
    expect(result[1]).toMatchObject({
      type: "embedding",
      name: "posts",
      spread: true,
    });
  });

  it("parses embedding with alias", () => {
    const result = parseSelect("id,my_posts:posts(id,title)");
    expect(result[1]).toMatchObject({
      type: "embedding",
      name: "posts",
      alias: "my_posts",
    });
  });

  it("parses nested embedding", () => {
    const result = parseSelect("id,posts(id,comments(id,body))");
    expect(result[1]).toMatchObject({
      type: "embedding",
      name: "posts",
    });
    const embedding = result[1] as any;
    expect(embedding.columns).toHaveLength(2);
    expect(embedding.columns[1]).toMatchObject({
      type: "embedding",
      name: "comments",
      columns: [
        { type: "column", name: "id" },
        { type: "column", name: "body" },
      ],
    });
  });

  it("parses star with embedding", () => {
    const result = parseSelect("*,posts(*)");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "star" });
    expect(result[1]).toMatchObject({
      type: "embedding",
      name: "posts",
      columns: [{ type: "star" }],
    });
  });
});
