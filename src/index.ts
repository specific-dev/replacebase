import { createApp } from "./server.js";
import type { ReplacebaseConfig, Replacebase } from "./types.js";
import { getRequestListener } from "@hono/node-server";
import { SignJWT } from "jose";

export type { ReplacebaseConfig, Replacebase, JwtClaims, RequestContext } from "./types.js";

export function createReplacebase(config: ReplacebaseConfig): Replacebase {
  const app = createApp(config);

  return {
    fetch: app.fetch.bind(app),
    toNodeHandler: () => getRequestListener(app.fetch.bind(app)),
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
