import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("REST Advanced Filters", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  // --- Regex matching ---

  it("filters with match (regex)", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .filter("title", "match", "^First");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("First Post");
  });

  it("filters with match (regex) no results", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .filter("title", "match", "^Nonexistent");

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("filters with imatch (case-insensitive regex)", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .filter("title", "imatch", "^first");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("First Post");
  });

  it("filters with imatch matching multiple rows", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .filter("title", "imatch", "post$");

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
  });

  // --- IS DISTINCT FROM ---

  it("filters with isdistinct on text column", async () => {
    const { data, error } = await env.supabase
      .from("profiles")
      .select("username")
      .filter("username", "isdistinct", "alice");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].username).toBe("bob");
  });

  it("filters with isdistinct on boolean column", async () => {
    // published IS DISTINCT FROM true returns rows where published is false
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .filter("published", "isdistinct", "true");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("Second Post");
  });

  // --- Full-text search ---

  it("filters with fts (to_tsquery)", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .textSearch("search_vector", "hello");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("First Post");
  });

  it("filters with fts using AND", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .textSearch("search_vector", "'hello' & 'world'");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("First Post");
  });

  it("filters with plfts (plainto_tsquery)", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .textSearch("search_vector", "hello world", { type: "plain" });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("First Post");
  });

  it("filters with phfts (phraseto_tsquery)", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .textSearch("search_vector", "hello world", { type: "phrase" });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("First Post");
  });

  it("filters with wfts (websearch_to_tsquery)", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .textSearch("search_vector", "hello OR bob", { type: "websearch" });

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    const titles = data!.map((r: any) => r.title).sort();
    expect(titles).toEqual(["First Post", "Third Post"]);
  });

  it("filters with fts returns no results for unmatched term", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .textSearch("search_vector", "nonexistent");

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // --- Array operators ---

  it("filters with contains (cs) on array column", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .contains("tags", ["tech", "hello"]);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("First Post");
  });

  it("filters with contains (cs) partial match", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .contains("tags", ["tech"]);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    const titles = data!.map((r: any) => r.title).sort();
    expect(titles).toEqual(["First Post", "Third Post"]);
  });

  it("filters with containedBy (cd) on array column", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .containedBy("tags", ["tech", "hello", "life"]);

    expect(error).toBeNull();
    // All three posts have tags that are subsets of ['tech', 'hello', 'life']
    expect(data).toHaveLength(3);
  });

  it("filters with overlaps (ov) on array column", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .overlaps("tags", ["life"]);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    const titles = data!.map((r: any) => r.title).sort();
    expect(titles).toEqual(["Second Post", "Third Post"]);
  });
});
