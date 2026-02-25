import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("Auth Admin Endpoints", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;
  let createdUserId: string;

  beforeAll(async () => {
    env = await createTestEnv();

    // Sign up a user for testing
    await env.supabase.auth.signUp({
      email: "admin-test@example.com",
      password: "password123",
    });
  });

  afterAll(() => env.cleanup());

  it("lists users with service role key", async () => {
    const { data, error } = await env.serviceSupabase.auth.admin.listUsers();

    expect(error).toBeNull();
    expect(data.users.length).toBeGreaterThanOrEqual(1);
    expect(data.users[0]).toHaveProperty("email");
  });

  it("creates a user with service role key", async () => {
    const { data, error } = await env.serviceSupabase.auth.admin.createUser({
      email: "admin-created@example.com",
      password: "password123",
      email_confirm: true,
    });

    expect(error).toBeNull();
    expect(data.user).toHaveProperty("id");
    expect(data.user!.email).toBe("admin-created@example.com");
    createdUserId = data.user!.id;
  });

  it("gets a user by id with service role key", async () => {
    const { data, error } =
      await env.serviceSupabase.auth.admin.getUserById(createdUserId);

    expect(error).toBeNull();
    expect(data.user!.email).toBe("admin-created@example.com");
  });

  it("updates a user with service role key", async () => {
    const { data, error } =
      await env.serviceSupabase.auth.admin.updateUserById(createdUserId, {
        user_metadata: { role: "admin" },
      });

    expect(error).toBeNull();
    expect(data.user!.user_metadata).toEqual({ role: "admin" });
  });

  it("deletes a user with service role key", async () => {
    const { error } =
      await env.serviceSupabase.auth.admin.deleteUser(createdUserId);

    expect(error).toBeNull();

    // Verify user is gone
    const { error: getError } =
      await env.serviceSupabase.auth.admin.getUserById(createdUserId);
    expect(getError).not.toBeNull();
  });

  it("rejects admin operations with anon key", async () => {
    const { error } = await env.supabase.auth.admin.listUsers();
    expect(error).not.toBeNull();
  });
});
