import { Hono } from "hono";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { ResolvedConfig } from "./types";
import type { JwtKeys } from "./keys";
import { apiKeyMiddleware } from "./middleware/api-key";
import { supabaseCors } from "./middleware/cors";
import { createRestRouter } from "./rest/index";
import { createAuthRouter } from "./auth/index";
import { createStorageRouter } from "./storage/index";

export function createApp(config: ResolvedConfig, keys: JwtKeys): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", supabaseCors());

  // Health check (no auth)
  app.get("/health", (c) => c.json({ status: "ok" }));

  // API key validation for REST routes
  app.use("/rest/*", apiKeyMiddleware(keys));

  // API key validation for auth routes (Supabase client sends apikey)
  app.use("/auth/*", apiKeyMiddleware(keys));

  // Mount REST router
  const restRouter = createRestRouter(
    config.db as PgDatabase<any, any, any>,
    config.schema,
    config.foreignKeys
  );
  app.route("/rest/v1", restRouter);

  // Mount Auth router
  const authRouter = createAuthRouter(
    config.db as PgDatabase<any, any, any>,
    keys
  );
  app.route("/auth/v1", authRouter);

  // Conditionally mount Storage router
  if (config.storage) {
    const storageRouter = createStorageRouter(
      config.db as PgDatabase<any, any, any>,
      keys,
      config.storage
    );
    app.route("/storage/v1", storageRouter);
  }

  return app;
}
