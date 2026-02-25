import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("REST Select", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  it("selects all rows from a table", async () => {
    const { data, error } = await env.supabase.from("posts").select();

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
  });

  it("selects specific columns", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("id,title");

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    expect(Object.keys(data![0])).toEqual(["id", "title"]);
  });

  it("filters with eq", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select()
      .eq("title", "First Post");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("First Post");
  });

  it("filters with neq", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select()
      .neq("title", "First Post");

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("filters with in", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select()
      .in("user_id", [env.userId1]);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("filters with is null", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select()
      .is("body", null);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("orders results ascending", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .order("title", { ascending: true });

    expect(error).toBeNull();
    expect(data![0].title).toBe("First Post");
    expect(data![2].title).toBe("Third Post");
  });

  it("orders results descending", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title")
      .order("title", { ascending: false });

    expect(error).toBeNull();
    expect(data![0].title).toBe("Third Post");
    expect(data![2].title).toBe("First Post");
  });

  it("applies limit", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select()
      .order("title")
      .limit(2);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("applies offset with range", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select()
      .order("title", { ascending: true })
      .range(1, 1);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("Second Post");
  });

  it("returns exact count", async () => {
    const { data, count, error } = await env.supabase
      .from("posts")
      .select("*", { count: "exact" })
      .limit(2);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(count).toBe(3);
  });

  it("returns single object", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select()
      .eq("title", "First Post")
      .single();

    expect(error).toBeNull();
    expect(data!.title).toBe("First Post");
    expect(Array.isArray(data)).toBe(false);
  });

  it("returns error for single with multiple rows", async () => {
    const { error } = await env.supabase.from("posts").select().single();

    expect(error).not.toBeNull();
  });

  it("returns error for non-existent table", async () => {
    const { error } = await env.supabase.from("nonexistent").select();

    expect(error).not.toBeNull();
  });

  it("handles boolean filter", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select()
      .eq("published", true);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.every((p: any) => p.published === true)).toBe(true);
  });

  it("handles or filter", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select()
      .or("title.eq.First Post,title.eq.Third Post");

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });
});
