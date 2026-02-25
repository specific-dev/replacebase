import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("Auth User", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();

    await env.supabase.auth.signUp({
      email: "user@example.com",
      password: "password123",
      options: {
        data: { name: "Test User" },
      },
    });
  });

  afterAll(() => env.cleanup());

  it("gets current user", async () => {
    const { data, error } = await env.supabase.auth.getUser();

    expect(error).toBeNull();
    expect(data.user?.email).toBe("user@example.com");
    expect(data.user?.user_metadata?.name).toBe("Test User");
    expect(data.user?.identities).toHaveLength(1);
  });

  it("updates user metadata", async () => {
    const { data, error } = await env.supabase.auth.updateUser({
      data: { name: "Updated User", bio: "Hello" },
    });

    expect(error).toBeNull();
    expect(data.user?.user_metadata?.name).toBe("Updated User");
    expect(data.user?.user_metadata?.bio).toBe("Hello");
  });

  it("rejects unauthenticated request", async () => {
    // Use getUser with the anon key (no sub claim) to test server-side rejection
    const { error } = await env.supabase.auth.getUser(env.anonKey);

    expect(error).not.toBeNull();
  });
});
