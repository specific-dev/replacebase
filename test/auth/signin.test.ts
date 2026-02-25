import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("Auth Sign In", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();

    await env.supabase.auth.signUp({
      email: "signin@example.com",
      password: "password123",
    });
  });

  afterAll(() => env.cleanup());

  it("signs in with correct credentials", async () => {
    const { data, error } = await env.supabase.auth.signInWithPassword({
      email: "signin@example.com",
      password: "password123",
    });

    expect(error).toBeNull();
    expect(data.user?.email).toBe("signin@example.com");
    expect(data.session?.access_token).toBeDefined();
    expect(data.session?.refresh_token).toBeDefined();
  });

  it("rejects incorrect password", async () => {
    const { data, error } = await env.supabase.auth.signInWithPassword({
      email: "signin@example.com",
      password: "wrongpassword",
    });

    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });

  it("rejects non-existent user", async () => {
    const { data, error } = await env.supabase.auth.signInWithPassword({
      email: "noexist@example.com",
      password: "password123",
    });

    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });
});
