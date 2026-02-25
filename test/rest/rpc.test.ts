import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createTestEnv } from "../helpers";

describe("REST RPC (Stored Procedures)", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();

    // Create test functions
    await env.db.execute(sql`
      CREATE OR REPLACE FUNCTION hello(name text)
      RETURNS text AS $$
      BEGIN
        RETURN 'Hello, ' || name || '!';
      END;
      $$ LANGUAGE plpgsql
    `);

    await env.db.execute(sql`
      CREATE OR REPLACE FUNCTION get_published_posts()
      RETURNS SETOF posts AS $$
      BEGIN
        RETURN QUERY SELECT * FROM posts WHERE published = true;
      END;
      $$ LANGUAGE plpgsql
    `);

    await env.db.execute(sql`
      CREATE OR REPLACE FUNCTION add_numbers(a integer, b integer)
      RETURNS integer AS $$
      BEGIN
        RETURN a + b;
      END;
      $$ LANGUAGE plpgsql
    `);
  });

  afterAll(() => env.cleanup());

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

  it("returns error for non-existent function", async () => {
    const { error } = await env.supabase.rpc("nonexistent_function");

    expect(error).not.toBeNull();
  });
});
