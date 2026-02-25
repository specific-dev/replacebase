import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("Auth Token Refresh", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;
  let initialRefreshToken: string;

  beforeAll(async () => {
    env = await createTestEnv();

    const { data } = await env.supabase.auth.signUp({
      email: "refresh@example.com",
      password: "password123",
    });
    initialRefreshToken = data.session!.refresh_token;
  });

  afterAll(() => env.cleanup());

  it("refreshes token successfully", async () => {
    const { data, error } = await env.supabase.auth.refreshSession();

    expect(error).toBeNull();
    expect(data.session?.access_token).toBeDefined();
    expect(data.session?.refresh_token).toBeDefined();
    expect(data.session?.refresh_token).not.toBe(initialRefreshToken);
    expect(data.user?.email).toBe("refresh@example.com");
  });

  it("rejects reused (rotated) refresh token", async () => {
    // The initial refresh token was already consumed by the previous test
    const { error } = await env.supabase.auth.refreshSession({
      refresh_token: initialRefreshToken,
    });

    expect(error).not.toBeNull();
  });

  it("rejects invalid refresh token", async () => {
    const { error } = await env.supabase.auth.refreshSession({
      refresh_token: "invalid-token",
    });

    expect(error).not.toBeNull();
  });
});
