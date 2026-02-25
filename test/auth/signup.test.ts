import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("Auth Signup", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  it("signs up a new user", async () => {
    const { data, error } = await env.supabase.auth.signUp({
      email: "test@example.com",
      password: "password123",
      options: {
        data: { name: "Test User" },
      },
    });

    expect(error).toBeNull();
    expect(data.user).toBeDefined();
    expect(data.user?.email).toBe("test@example.com");
    expect(data.user?.user_metadata?.name).toBe("Test User");
    expect(data.session).toBeDefined();
    expect(data.session?.access_token).toBeDefined();
    expect(data.session?.refresh_token).toBeDefined();
    expect(data.user?.identities).toHaveLength(1);
    expect(data.user?.identities?.[0].provider).toBe("email");
  });

  it("rejects duplicate email", async () => {
    await env.supabase.auth.signUp({
      email: "dupe@example.com",
      password: "password123",
    });

    const { error } = await env.supabase.auth.signUp({
      email: "dupe@example.com",
      password: "password456",
    });

    expect(error).not.toBeNull();
  });

  it("rejects signup without password", async () => {
    const { error } = await env.supabase.auth.signUp({
      email: "nopass@example.com",
      password: "",
    });

    expect(error).not.toBeNull();
  });
});
