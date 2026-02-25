import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("REST Upsert", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  it("upserts with merge-duplicates (updates existing row)", async () => {
    // First insert a profile
    const { error: insertError } = await env.supabase
      .from("profiles")
      .upsert({
        id: "99999999-9999-9999-9999-999999999999",
        username: "charlie",
        bio: "Original bio",
      });

    expect(insertError).toBeNull();

    // Now upsert with same id but different data
    const { data, error } = await env.supabase
      .from("profiles")
      .upsert({
        id: "99999999-9999-9999-9999-999999999999",
        username: "charlie_updated",
        bio: "Updated bio",
      })
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].username).toBe("charlie_updated");
    expect(data![0].bio).toBe("Updated bio");
  });

  it("upserts with ignore-duplicates (keeps existing row)", async () => {
    const { data, error } = await env.supabase
      .from("profiles")
      .upsert(
        {
          id: env.userId1,
          username: "should_not_change",
          bio: "should_not_change",
        },
        { ignoreDuplicates: true }
      )
      .select();

    expect(error).toBeNull();
    // Should not have updated — original row kept
    const { data: check } = await env.supabase
      .from("profiles")
      .select()
      .eq("id", env.userId1)
      .single();

    expect(check!.username).toBe("alice");
  });

  it("upserts multiple rows", async () => {
    const { data, error } = await env.supabase
      .from("profiles")
      .upsert([
        { id: env.userId1, username: "alice_v2", bio: "Updated Alice" },
        {
          id: "33333333-3333-3333-3333-333333333333",
          username: "dave",
          bio: "New user Dave",
        },
      ])
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(2);

    // Verify both
    const { data: all } = await env.supabase
      .from("profiles")
      .select()
      .in("id", [env.userId1, "33333333-3333-3333-3333-333333333333"]);

    expect(all).toHaveLength(2);
    const alice = all!.find((p: any) => p.id === env.userId1);
    expect(alice!.username).toBe("alice_v2");
  });
});
