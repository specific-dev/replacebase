import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("REST RPC (Stored Procedures)", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  // ─── Basic RPC calls ───────────────────────────────────────────────

  it("calls a scalar function", async () => {
    const { data, error } = await env.supabase.rpc("hello", { name: "World" });

    expect(error).toBeNull();
    expect(data).toBe("Hello, World!");
  });

  it("calls a function returning a set of rows", async () => {
    const { data, error } = await env.supabase.rpc("get_published_posts");

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("calls a function with numeric params", async () => {
    const { data, error } = await env.supabase.rpc("add_numbers", {
      a: 3,
      b: 4,
    });

    expect(error).toBeNull();
    expect(data).toBe(7);
  });

  // ─── Void functions ────────────────────────────────────────────────

  it("calls a void function", async () => {
    const { error } = await env.supabase.rpc("do_nothing");

    expect(error).toBeNull();
  });

  // ─── Filtering on set-returning functions ──────────────────────────

  it("filters results with .eq()", async () => {
    const { data, error } = await env.supabase
      .rpc("get_all_posts")
      .eq("published", true);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    for (const row of data!) {
      expect(row.published).toBe(true);
    }
  });

  it("filters results with .neq()", async () => {
    const { data, error } = await env.supabase
      .rpc("get_all_posts")
      .neq("title", "First Post");

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    for (const row of data!) {
      expect(row.title).not.toBe("First Post");
    }
  });

  it("filters results with .in()", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .in("title", ["First Post", "Third Post"]);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("filters results with .is() for booleans", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .is("published", false);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("Second Post");
  });

  // ─── Ordering ──────────────────────────────────────────────────────

  it("orders results ascending", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .order("title", { ascending: true });

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    expect(data![0].title).toBe("First Post");
    expect(data![1].title).toBe("Second Post");
    expect(data![2].title).toBe("Third Post");
  });

  it("orders results descending", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .order("title", { ascending: false });

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    expect(data![0].title).toBe("Third Post");
    expect(data![1].title).toBe("Second Post");
    expect(data![2].title).toBe("First Post");
  });

  // ─── Pagination (limit / range) ───────────────────────────────────

  it("limits results with .limit()", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .order("title", { ascending: true })
      .limit(2);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data![0].title).toBe("First Post");
    expect(data![1].title).toBe("Second Post");
  });

  it("paginates results with .range()", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .order("title", { ascending: true })
      .range(1, 2);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data![0].title).toBe("Second Post");
    expect(data![1].title).toBe("Third Post");
  });

  // ─── Column selection ──────────────────────────────────────────────

  it("selects specific columns with .select()", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .select("id,title");

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    for (const row of data!) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("title");
      expect(row).not.toHaveProperty("published");
    }
  });

  // ─── Count ─────────────────────────────────────────────────────────

  it("returns count with exact option", async () => {
    const { data, count, error } = await env.supabase
      .rpc("get_post_summaries", undefined, { count: "exact" });

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    expect(count).toBe(3);
  });

  it("returns count with filters applied", async () => {
    const { data, count, error } = await env.supabase
      .rpc("get_post_summaries", undefined, { count: "exact" })
      .eq("published", true);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(count).toBe(2);
  });

  // ─── Single object response (.single()) ───────────────────────────

  it("returns single object with .single()", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .eq("title", "First Post")
      .single();

    expect(error).toBeNull();
    expect(data).toHaveProperty("title", "First Post");
    expect(Array.isArray(data)).toBe(false);
  });

  it("returns error when .single() gets no rows", async () => {
    const { error } = await env.supabase
      .rpc("get_post_summaries")
      .eq("title", "Nonexistent Post")
      .single();

    expect(error).not.toBeNull();
  });

  it("returns error when .single() gets multiple rows", async () => {
    const { error } = await env.supabase
      .rpc("get_post_summaries")
      .eq("published", true)
      .single();

    expect(error).not.toBeNull();
  });

  // ─── maybeSingle ──────────────────────────────────────────────────

  it("returns null with .maybeSingle() when no rows match", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .eq("title", "Nonexistent Post")
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("returns single object with .maybeSingle() when one row matches", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .eq("title", "First Post")
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toHaveProperty("title", "First Post");
  });

  // ─── CSV response ─────────────────────────────────────────────────

  it("returns CSV with .csv()", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .order("title", { ascending: true })
      .csv();

    expect(error).toBeNull();
    expect(typeof data).toBe("string");
    const lines = (data as unknown as string).split("\n");
    // Header + 3 data rows
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("title");
    expect(lines[0]).toContain("published");
  });

  // ─── GET method (read-only) ────────────────────────────────────────

  it("calls function via GET with { get: true }", async () => {
    const { data, error } = await env.supabase.rpc(
      "hello",
      { name: "GET" },
      { get: true }
    );

    expect(error).toBeNull();
    expect(data).toBe("Hello, GET!");
  });

  it("calls set-returning function via GET", async () => {
    const { data, error } = await env.supabase.rpc(
      "get_post_summaries",
      undefined,
      { get: true }
    );

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
  });

  // ─── HEAD method ───────────────────────────────────────────────────

  it("calls function via HEAD with { head: true }", async () => {
    const { error } = await env.supabase.rpc(
      "get_post_summaries",
      undefined,
      { head: true, count: "exact" }
    );

    // HEAD returns no body, just headers
    expect(error).toBeNull();
  });

  // ─── Combined modifiers ────────────────────────────────────────────

  it("combines filter + order + limit", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .eq("published", true)
      .order("title", { ascending: false })
      .limit(1);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("Third Post");
  });

  it("combines select + filter + order", async () => {
    const { data, error } = await env.supabase
      .rpc("get_post_summaries")
      .select("title")
      .eq("published", true)
      .order("title", { ascending: true });

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data![0]).toEqual({ title: "First Post" });
    expect(data![1]).toEqual({ title: "Third Post" });
  });

  // ─── Function with UUID params ─────────────────────────────────────

  it("calls function with UUID parameter", async () => {
    const { data, error } = await env.supabase.rpc("get_posts_by_user", {
      uid: env.userId1,
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    for (const row of data!) {
      expect(row.user_id).toBe(env.userId1);
    }
  });

  it("filters results from function with UUID param", async () => {
    const { data, error } = await env.supabase
      .rpc("get_posts_by_user", { uid: env.userId1 })
      .eq("published", true);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("First Post");
  });

  // ─── Identifier validation ──────────────────────────────────────

  it("rejects non-existent function with 404", async () => {
    const { data, error } = await env.supabase.rpc("nonexistent_function");

    expect(error).not.toBeNull();
    expect(error!.code).toBe("PGRST202");
    expect(error!.message).toContain("does not exist");
  });

  it("rejects unknown parameter names", async () => {
    const { error } = await env.supabase.rpc("hello", {
      name: "World",
      bogus_param: "injection",
    } as any);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("PGRST202");
    expect(error!.message).toContain("bogus_param");
  });

  it("rejects unknown column in filter for TABLE-returning function", async () => {
    const { error } = await env.supabase
      .rpc("get_post_summaries")
      .eq("nonexistent_column" as any, "value");

    expect(error).not.toBeNull();
    expect(error!.code).toBe("PGRST204");
    expect(error!.message).toContain("nonexistent_column");
  });

  it("rejects unknown column in select for TABLE-returning function", async () => {
    const { error } = await env.supabase
      .rpc("get_post_summaries")
      .select("id,fake_column" as any);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("PGRST204");
    expect(error!.message).toContain("fake_column");
  });

  it("rejects unknown column in order for TABLE-returning function", async () => {
    const { error } = await env.supabase
      .rpc("get_post_summaries")
      .order("nonexistent_column" as any);

    expect(error).not.toBeNull();
    expect(error!.code).toBe("PGRST204");
    expect(error!.message).toContain("nonexistent_column");
  });
});
