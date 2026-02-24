import { Hono } from "hono";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { ReplacebaseConfig } from "./types.js";
import { apiKeyMiddleware } from "./middleware/api-key.js";
import { supabaseCors } from "./middleware/cors.js";
import { createRestRouter } from "./rest/index.js";

export function createApp(config: ReplacebaseConfig): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", supabaseCors());

  // Health check (no auth)
  app.get("/health", (c) => c.json({ status: "ok" }));

  // API key validation for all protected routes
  app.use("/rest/*", apiKeyMiddleware(config.jwtSecret));

  // Mount REST router
  const restRouter = createRestRouter(
    config.db as PgDatabase<any, any, any>,
    config.schema
  );
  app.route("/rest/v1", restRouter);

  return app;
}
