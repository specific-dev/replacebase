import { createApp } from "./server";
import type { ReplacebaseConfig, ResolvedConfig, Replacebase } from "./types";
import { getRequestListener } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { SignJWT } from "jose";
import { createRealtimeHandler } from "./realtime/index.js";
import { resolveKeys } from "./keys";
import type { JwtKeys } from "./keys";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { introspectDatabase } from "./rest/introspect";

export type { ReplacebaseConfig, Replacebase, JwtClaims, RequestContext, StorageConfig } from "./types";
export type { JwtKeys } from "./keys";

export async function createReplacebase(config: ReplacebaseConfig): Promise<Replacebase> {
  const pgClient = postgres(config.databaseUrl);
  const db = drizzle(pgClient);

  const { tables, foreignKeys } = await introspectDatabase(
    db as any,
    config.schemas ?? ["public"]
  );

  const resolved: ResolvedConfig = {
    db: db as any,
    schema: tables,
    foreignKeys,
    jwtSecret: config.jwtSecret,
    jwksUrl: config.jwksUrl,
    storage: config.storage,
    basePath: normalizeBasePath(config.basePath),
  };

  return createReplacebaseFromResolved(resolved);
}

/**
 * Internal constructor used by tests (which use PGlite and provide their own db + schema).
 * Not part of the public API.
 */
export function createReplacebaseInternal(config: ResolvedConfig): Replacebase {
  return createReplacebaseFromResolved(config);
}

function createReplacebaseFromResolved(config: ResolvedConfig): Replacebase {
  const keys = resolveKeys(config);
  const app = createApp(config, keys);

  // WebSocket support for Realtime
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
  const realtimeHandler = createRealtimeHandler(keys);

  app.get(
    "/realtime/v1/websocket",
    realtimeHandler.apiKeyCheck,
    upgradeWebSocket((c) => realtimeHandler.handleConnection(c))
  );

  return {
    fetch: app.fetch.bind(app),
    toNodeHandler: () => getRequestListener(app.fetch.bind(app)),
    injectWebSocket,
    app,
  };
}

function normalizeBasePath(basePath: string | undefined): string | undefined {
  if (!basePath) return undefined;
  // Ensure leading slash
  let normalized = basePath.startsWith("/") ? basePath : `/${basePath}`;
  // Strip trailing slash
  normalized = normalized.replace(/\/+$/, "");
  return normalized || undefined;
}

export async function generateKeys(jwtSecret: string): Promise<{
  anonKey: string;
  serviceRoleKey: string;
}> {
  const secret = new TextEncoder().encode(jwtSecret);

  const anonKey = await new SignJWT({ role: "anon", iss: "replacebase" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("10y")
    .sign(secret);

  const serviceRoleKey = await new SignJWT({
    role: "service_role",
    iss: "replacebase",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("10y")
    .sign(secret);

  return { anonKey, serviceRoleKey };
}
