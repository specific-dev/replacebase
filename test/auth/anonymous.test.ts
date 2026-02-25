import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("Auth Anonymous Sign-In", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  it("signs in anonymously", async () => {
    const { data, error } = await env.supabase.auth.signInAnonymously();

    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
    expect(data.session!.access_token).toBeDefined();
    expect(data.session!.refresh_token).toBeDefined();
    expect(data.user).not.toBeNull();
    expect(data.user!.is_anonymous).toBe(true);
  });

  it("anonymous user can refresh their token", async () => {
    const { data: anonData } = await env.supabase.auth.signInAnonymously();
    const refreshToken = anonData.session!.refresh_token;

    const { data, error } = await env.supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
  });
});
