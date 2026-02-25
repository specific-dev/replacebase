import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("Auth Password Recovery", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();

    await env.supabase.auth.signUp({
      email: "recover@example.com",
      password: "password123",
    });
  });

  afterAll(() => env.cleanup());

  it("sends password recovery email (returns success)", async () => {
    const { error } = await env.supabase.auth.resetPasswordForEmail(
      "recover@example.com"
    );

    expect(error).toBeNull();
  });

  it("returns success even for non-existent email (no information leak)", async () => {
    const { error } = await env.supabase.auth.resetPasswordForEmail(
      "nonexistent@example.com"
    );

    // Should not leak whether user exists
    expect(error).toBeNull();
  });
});
