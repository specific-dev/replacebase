import { SignJWT } from "jose";
import { createReplacebase } from "../src/index.js";
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

  const anonKey = await createApiKey("anon");
  const serviceRoleKey = await createApiKey("service_role");

  return {
    pglite,
    db,
    replacebase,
    anonKey,
    serviceRoleKey,
    userId1,
    userId2,
    jwtSecret: TEST_JWT_SECRET,
  };
}

export async function createApiKey(role: string): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new SignJWT({ role, iss: "replacebase" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

export async function createUserToken(
  userId: string,
  role: string = "authenticated"
): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new SignJWT({
    sub: userId,
    role,
    iss: "replacebase",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

export async function restRequest(
  replacebase: ReturnType<typeof createReplacebase>,
  path: string,
  options: {
    method?: string;
    apiKey: string;
    userToken?: string;
    body?: any;
    headers?: Record<string, string>;
  }
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: options.apiKey,
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (options.userToken) {
    headers["Authorization"] = `Bearer ${options.userToken}`;
  } else {
    headers["Authorization"] = `Bearer ${options.apiKey}`;
  }

  const request = new Request(`http://localhost/rest/v1${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return await replacebase.fetch(request);
}
