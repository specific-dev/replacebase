import { Hono } from "hono";
import type { ReplacebaseConfig } from "./types.js";

export function createApp(config: ReplacebaseConfig): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}
