import { createApp } from "./server";
import type { ReplacebaseConfig, Replacebase } from "./types";
import { getRequestListener } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { SignJWT } from "jose";
import { createRealtimeHandler } from "./realtime/index.js";
import { resolveKeys } from "./keys";
import type { JwtKeys } from "./keys";

export type { ReplacebaseConfig, Replacebase, JwtClaims, RequestContext, StorageConfig } from "./types";
export type { JwtKeys } from "./keys";

export function createReplacebase(config: ReplacebaseConfig): Replacebase {
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
