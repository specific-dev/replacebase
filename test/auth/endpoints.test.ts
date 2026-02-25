import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("Auth Misc Endpoints", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  it("returns health check", async () => {
    const res = await fetch(
      `http://localhost:${env.port}/auth/v1/health`,
      { headers: { apikey: env.anonKey } }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("GoTrue");
  });

  it("returns settings", async () => {
    const res = await fetch(
      `http://localhost:${env.port}/auth/v1/settings`,
      { headers: { apikey: env.anonKey } }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.external.email).toBe(true);
    expect(body.mailer_autoconfirm).toBe(true);
  });

  it("updates user email", async () => {
    const { data: signup } = await env.supabase.auth.signUp({
      email: "update-email@example.com",
      password: "password123",
    });

    const { data, error } = await env.supabase.auth.updateUser({
      email: "new-email@example.com",
    });

    expect(error).toBeNull();
    expect(data.user!.email).toBe("new-email@example.com");
  });

  it("updates user password", async () => {
    await env.supabase.auth.signUp({
      email: "update-pass@example.com",
      password: "oldpassword",
    });

    const { error: updateError } = await env.supabase.auth.updateUser({
      password: "newpassword",
    });
    expect(updateError).toBeNull();

    // Sign out and sign in with new password
    await env.supabase.auth.signOut();

    const { error } = await env.supabase.auth.signInWithPassword({
      email: "update-pass@example.com",
      password: "newpassword",
    });
    expect(error).toBeNull();
  });
});
