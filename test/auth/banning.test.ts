import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("Auth User Banning", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();

    // Create a user
    await env.supabase.auth.signUp({
      email: "ban-test@example.com",
      password: "password123",
    });
  });

  afterAll(() => env.cleanup());

  it("rejects sign-in for banned user", async () => {
    // Ban the user via admin endpoint
    const { data: users } =
      await env.serviceSupabase.auth.admin.listUsers();
    const user = users.users.find((u: any) => u.email === "ban-test@example.com");

    await env.serviceSupabase.auth.admin.updateUserById(user!.id, {
      ban_duration: "876000h", // ~100 years
    });

    // Try to sign in
    const { error } = await env.supabase.auth.signInWithPassword({
      email: "ban-test@example.com",
      password: "password123",
    });

    expect(error).not.toBeNull();
  });

  it("allows sign-in after ban expires", async () => {
    // Create another user and ban with expired duration
    await env.supabase.auth.signUp({
      email: "unban-test@example.com",
      password: "password123",
    });

    const { data: users } =
      await env.serviceSupabase.auth.admin.listUsers();
    const user = users.users.find(
      (u: any) => u.email === "unban-test@example.com"
    );

    // Set banned_until to the past
    await env.serviceSupabase.auth.admin.updateUserById(user!.id, {
      ban_duration: "0s",
    });

    // Sign in should work
    const { error } = await env.supabase.auth.signInWithPassword({
      email: "unban-test@example.com",
      password: "password123",
    });

    expect(error).toBeNull();
  });
});
