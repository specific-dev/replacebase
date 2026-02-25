import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("REST Insert", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  it("inserts a row and returns it", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .insert({
        title: "New Post",
        body: "New body",
        user_id: env.userId1,
      })
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("New Post");
    expect(data![0].id).toBeDefined();
  });

  it("inserts multiple rows", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .insert([
        { title: "Batch 1", body: "b1", user_id: env.userId1 },
        { title: "Batch 2", body: "b2", user_id: env.userId2 },
      ])
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("inserts without returning data", async () => {
    const { data, error } = await env.supabase.from("posts").insert({
      title: "Minimal Post",
      body: "minimal",
      user_id: env.userId1,
    });

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("inserts with exact count", async () => {
    const { count, error } = await env.supabase
      .from("posts")
      .insert(
        [
          { title: "Count 1", body: "c1", user_id: env.userId1 },
          { title: "Count 2", body: "c2", user_id: env.userId1 },
        ],
        { count: "exact" }
      )
      .select();

    expect(error).toBeNull();
    expect(count).toBe(2);
  });
});
