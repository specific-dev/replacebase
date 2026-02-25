import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";

export function supabaseCors() {
  const corsHandler = cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Authorization",
      "apikey",
      "X-Client-Info",
      "Content-Type",
      "Accept",
      "Prefer",
      "Range",
    ],
    exposeHeaders: ["Content-Range", "Range-Unit", "X-Total-Count"],
    maxAge: 86400,
  });

  // Skip CORS for WebSocket upgrade requests to avoid immutable header errors
  return createMiddleware(async (c, next) => {
    if (c.req.header("upgrade")?.toLowerCase() === "websocket") {
      return next();
    }
    return corsHandler(c, next);
  });
}
