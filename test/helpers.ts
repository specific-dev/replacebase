import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createReplacebase, generateKeys } from "../src/index.js";
import { createTestDb, seedTestData } from "./setup.js";
import { testSchema } from "./fixtures/schema.js";

const TEST_JWT_SECRET = "test-secret-for-replacebase-testing";

export async function createTestEnv() {
  const { pglite, db } = await createTestDb();
  const { userId1, userId2 } = await seedTestData(db);

  const replacebase = createReplacebase({
    db: db as any,
    schema: testSchema,
    jwtSecret: TEST_JWT_SECRET,
  });

  const keys = await generateKeys(TEST_JWT_SECRET);

  const server = serve({
    fetch: replacebase.fetch as any,
    port: 0,
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const supabase = createClient(`http://localhost:${port}`, keys.anonKey);
  const serviceSupabase = createClient(
    `http://localhost:${port}`,
    keys.serviceRoleKey
  );

  return {
    pglite,
    db,
    replacebase,
    supabase,
    serviceSupabase,
    anonKey: keys.anonKey,
    serviceRoleKey: keys.serviceRoleKey,
    userId1,
    userId2,
    jwtSecret: TEST_JWT_SECRET,
    port,
    cleanup: () => server?.close(),
  };
}
