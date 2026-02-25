import { Hono } from "hono";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { ReplacebaseConfig } from "./types";
import { apiKeyMiddleware } from "./middleware/api-key";
import { supabaseCors } from "./middleware/cors";
import { createRestRouter } from "./rest/index";
import { createAuthRouter } from "./auth/index";
import { createStorageRouter } from "./storage/index";

export function createApp(config: ReplacebaseConfig): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", supabaseCors());

  // Health check (no auth)
  app.get("/health", (c) => c.json({ status: "ok" }));

  // API key validation for REST routes
  app.use("/rest/*", apiKeyMiddleware(config.jwtSecret));

  // API key validation for auth routes (Supabase client sends apikey)
  app.use("/auth/*", apiKeyMiddleware(config.jwtSecret));

  // Mount REST router
  const restRouter = createRestRouter(
    config.db as PgDatabase<any, any, any>,
    config.schema
  );
  app.route("/rest/v1", restRouter);

  // Mount Auth router
  const authRouter = createAuthRouter(
    config.db as PgDatabase<any, any, any>,
    config.jwtSecret
  );
  app.route("/auth/v1", authRouter);

  // Conditionally mount Storage router
  if (config.storage) {
    const storageRouter = createStorageRouter(
      config.db as PgDatabase<any, any, any>,
      config.jwtSecret,
      config.storage
    );
    app.route("/storage/v1", storageRouter);
  }

  return app;
}
