import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createReplacebaseInternal, generateKeys } from "../src/index";
import { createTestDb, seedTestData } from "./setup";
import { introspectDatabase } from "../src/rest/introspect";

const TEST_JWT_SECRET = "test-secret-for-replacebase-testing";

describe("Base Path", () => {
  let supabase: ReturnType<typeof createClient>;
  let cleanup: () => void;

  beforeAll(async () => {
    const { pglite, db } = await createTestDb();
    const { userId1, userId2 } = await seedTestData(db);

    const { tables, foreignKeys } = await introspectDatabase(db as any);

    const replacebase = createReplacebaseInternal({
      db: db as any,
      schema: tables,
      foreignKeys,
      jwtSecret: TEST_JWT_SECRET,
      basePath: "/api/supabase",
    });

    const keys = await generateKeys(TEST_JWT_SECRET);

    const server = serve({
      fetch: replacebase.fetch as any,
      port: 0,
    });

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    supabase = createClient(
      `http://localhost:${port}/api/supabase`,
      keys.anonKey
    );

    cleanup = () => server?.close();
  });

  afterAll(() => cleanup());

  it("serves REST queries through the base path", async () => {
    const { data, error } = await supabase.from("posts").select();

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
  });

  it("serves auth signup through the base path", async () => {
    const { data, error } = await supabase.auth.signUp({
      email: "basepath@example.com",
      password: "password123",
    });

    expect(error).toBeNull();
    expect(data.user).toBeDefined();
    expect(data.user?.email).toBe("basepath@example.com");
    expect(data.session).toBeDefined();
    expect(data.session?.access_token).toBeDefined();
  });
});
