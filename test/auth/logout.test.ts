import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

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

describe("Auth Logout Scopes", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  it("global logout revokes all sessions", async () => {
    // Sign up and create two sessions
    const { data: signup } = await env.supabase.auth.signUp({
      email: "global-logout@example.com",
      password: "password123",
    });
    const refreshToken1 = signup.session!.refresh_token;

    // Sign in again to create a second session
    const { data: signin } = await env.supabase.auth.signInWithPassword({
      email: "global-logout@example.com",
      password: "password123",
    });
    const refreshToken2 = signin.session!.refresh_token;

    // Global logout (revokes all)
    const { error } = await env.supabase.auth.signOut({ scope: "global" });
    expect(error).toBeNull();

    // Both refresh tokens should be revoked
    const { error: err1 } = await env.supabase.auth.refreshSession({
      refresh_token: refreshToken1,
    });
    expect(err1).not.toBeNull();

    const { error: err2 } = await env.supabase.auth.refreshSession({
      refresh_token: refreshToken2,
    });
    expect(err2).not.toBeNull();
  });

  it("local logout only revokes current session", async () => {
    // Sign up
    const { data: signup } = await env.supabase.auth.signUp({
      email: "local-logout@example.com",
      password: "password123",
    });
    const refreshToken1 = signup.session!.refresh_token;

    // Sign in again to create a second session
    const { data: signin } = await env.supabase.auth.signInWithPassword({
      email: "local-logout@example.com",
      password: "password123",
    });
    const refreshToken2 = signin.session!.refresh_token;

    // Local logout (only current session - the second one)
    const { error } = await env.supabase.auth.signOut({ scope: "local" });
    expect(error).toBeNull();

    // First session's refresh token should still work
    const { error: err1 } = await env.supabase.auth.refreshSession({
      refresh_token: refreshToken1,
    });
    expect(err1).toBeNull();
  });
});
