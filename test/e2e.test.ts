import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createReplacebase, generateKeys } from "../src/index.js";
import { createTestDb, seedTestData } from "./setup.js";
import { testSchema } from "./fixtures/schema.js";

describe("End-to-End with Supabase Client", () => {
  let server: ReturnType<typeof serve>;
  let supabase: ReturnType<typeof createClient>;
  let port: number;
  const JWT_SECRET = "e2e-test-secret";

  beforeAll(async () => {
    const { db } = await createTestDb();

    const replacebase = createReplacebase({
      db: db as any,
      schema: testSchema,
      jwtSecret: JWT_SECRET,
    });

    const keys = await generateKeys(JWT_SECRET);

    // Start HTTP server on random port
    server = serve({
      fetch: replacebase.fetch as any,
      port: 0,
    });

    // Get the actual port
    const address = server.address();
    port = typeof address === "object" && address ? address.port : 0;

    // Create Supabase client pointed at our server
    supabase = createClient(
      `http://localhost:${port}`,
      keys.anonKey
    );
  });

  afterAll(() => {
    server?.close();
  });

  it("signs up a new user", async () => {
    const { data, error } = await supabase.auth.signUp({
      email: "e2e@example.com",
      password: "password123",
      options: {
        data: { name: "E2E User" },
      },
    });

    expect(error).toBeNull();
    expect(data.user).toBeDefined();
    expect(data.user?.email).toBe("e2e@example.com");
    expect(data.session).toBeDefined();
    expect(data.session?.access_token).toBeDefined();
  });

  it("signs in with password", async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: "e2e@example.com",
      password: "password123",
    });

    expect(error).toBeNull();
    expect(data.user?.email).toBe("e2e@example.com");
    expect(data.session?.access_token).toBeDefined();
  });

  it("gets current user", async () => {
    // Sign in first to get a session
    await supabase.auth.signInWithPassword({
      email: "e2e@example.com",
      password: "password123",
    });

    const { data, error } = await supabase.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.email).toBe("e2e@example.com");
  });

  it("updates user metadata", async () => {
    await supabase.auth.signInWithPassword({
      email: "e2e@example.com",
      password: "password123",
    });

    const { data, error } = await supabase.auth.updateUser({
      data: { bio: "Hello from E2E" },
    });

    expect(error).toBeNull();
    expect(data.user?.user_metadata?.bio).toBe("Hello from E2E");
  });

  it("performs CRUD on posts table", async () => {
    // Sign in
    const { data: authData } = await supabase.auth.signInWithPassword({
      email: "e2e@example.com",
      password: "password123",
    });
    const userId = authData.user!.id;

    // Insert
    const { data: insertData, error: insertError } = await supabase
      .from("posts")
      .insert({
        title: "E2E Post",
        body: "Created via Supabase client",
        user_id: userId,
        published: true,
      })
      .select();

    expect(insertError).toBeNull();
    expect(insertData).toHaveLength(1);
    expect(insertData![0].title).toBe("E2E Post");

    // Select
    const { data: selectData, error: selectError } = await supabase
      .from("posts")
      .select("id,title,published")
      .eq("title", "E2E Post");

    expect(selectError).toBeNull();
    expect(selectData).toHaveLength(1);
    expect(selectData![0].title).toBe("E2E Post");

    // Update
    const { data: updateData, error: updateError } = await supabase
      .from("posts")
      .update({ body: "Updated via Supabase client" })
      .eq("title", "E2E Post")
      .select();

    expect(updateError).toBeNull();
    expect(updateData).toHaveLength(1);
    expect(updateData![0].body).toBe("Updated via Supabase client");

    // Delete
    const { error: deleteError } = await supabase
      .from("posts")
      .delete()
      .eq("title", "E2E Post");

    expect(deleteError).toBeNull();

    // Verify deleted
    const { data: afterDelete } = await supabase
      .from("posts")
      .select()
      .eq("title", "E2E Post");

    expect(afterDelete).toHaveLength(0);
  });

  it("signs out", async () => {
    await supabase.auth.signInWithPassword({
      email: "e2e@example.com",
      password: "password123",
    });

    const { error } = await supabase.auth.signOut();
    expect(error).toBeNull();
  });
});
