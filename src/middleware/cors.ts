import { cors } from "hono/cors";

export function supabaseCors() {
  return cors({
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
}
