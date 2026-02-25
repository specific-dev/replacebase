import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("Auth Logout", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;
  let refreshToken: string;

  beforeAll(async () => {
    env = await createTestEnv();

    const { data } = await env.supabase.auth.signUp({
      email: "logout@example.com",
      password: "password123",
    });
    refreshToken = data.session!.refresh_token;
  });

  afterAll(() => env.cleanup());

  it("logs out successfully", async () => {
    const { error } = await env.supabase.auth.signOut();
    expect(error).toBeNull();
  });

  it("refresh token is revoked after logout", async () => {
    const { error } = await env.supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    expect(error).not.toBeNull();
  });
});
