import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createReplacebase, generateKeys } from "../src/index";
import { createTestDb, seedTestData } from "./setup";
import { testSchema } from "./fixtures/schema";
import S3rver from "s3rver";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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

  // Inject WebSocket handling for Realtime support
  replacebase.injectWebSocket(server);

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

export async function createStorageTestEnv() {
  const { pglite, db } = await createTestDb();
  const { userId1, userId2 } = await seedTestData(db);

  // Start local S3 server
  const s3Dir = mkdtempSync(join(tmpdir(), "replacebase-s3-"));
  const s3Server = new S3rver({
    port: 0,
    address: "localhost",
    silent: true,
    directory: s3Dir,
    resetOnClose: true,
    configureBuckets: [{ name: "test-bucket" }],
  });
  const s3Address = await s3Server.run();

  const storageConfig = {
    s3: {
      endpoint: `http://localhost:${s3Address.port}`,
      region: "us-east-1",
      bucket: "test-bucket",
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
      forcePathStyle: true,
    },
  };

  const replacebase = createReplacebase({
    db: db as any,
    schema: testSchema,
    jwtSecret: TEST_JWT_SECRET,
    storage: storageConfig,
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
    cleanup: async () => {
      server?.close();
      await s3Server.close();
    },
  };
}
