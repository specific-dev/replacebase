import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("REST Delete", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  it("deletes rows matching filter and returns them", async () => {
    // Verify the row exists
    const { data: before } = await env.supabase
      .from("posts")
      .select()
      .eq("title", "Second Post");
    expect(before).toHaveLength(1);

    // Delete with return (Second Post has no comments)
    const { data, error } = await env.supabase
      .from("posts")
      .delete()
      .eq("title", "Second Post")
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("Second Post");

    // Verify it's gone
    const { data: after } = await env.supabase
      .from("posts")
      .select()
      .eq("title", "Second Post");
    expect(after).toHaveLength(0);
  });

  it("deletes without returning data", async () => {
    const { data, error } = await env.supabase
      .from("profiles")
      .delete()
      .eq("id", env.userId2);

    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});
