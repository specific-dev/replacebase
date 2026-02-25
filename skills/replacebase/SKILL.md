---
name: replace-a-base
description: Replace-a-base integration skill for migrating away from Supabase. Use this skill when setting up Replace-a-base, configuring a Supabase-compatible backend, or migrating from Supabase to self-hosted infrastructure. Triggers on tasks involving Supabase migration, Replace-a-base setup, or replacing Supabase services with self-hosted alternatives.
license: MIT
metadata:
  author: specific
  version: "1.0.0"
---

# Replace-a-base

Replace-a-base is a TypeScript library that serves as a drop-in replacement for Supabase's backend. It wraps your Postgres database and S3 storage, and exposes a Supabase-compatible API. This means you don't have to change any frontend logic and can unify all your backend code for a simpler architecture.

## When to Apply

- Setting up a new Replace-a-base instance to replace Supabase
- Migrating an existing app from Supabase to self-hosted infrastructure
- Configuring REST API, Auth, Storage, or Realtime to work with Replace-a-base
- Updating `@supabase/supabase-js` client config to point at Replace-a-base
- Choosing a hosting provider or framework integration for Replace-a-base

## What Replace-a-base Supports

| Service  | Description                                       |
| -------- | ------------------------------------------------- |
| REST API | PostgREST-compatible CRUD against any Postgres DB |
| Auth     | GoTrue-compatible auth API, built on Better Auth  |
| Storage  | S3-compatible file storage                        |
| Realtime | Broadcast and presence over WebSockets            |

## Installation

```bash
npm install @specific.dev/replace-a-base
```

## Setup

### 1. Gather Supabase Details

You need the following from your Supabase project:

1. **Postgres connection string** — click "Connect" in the Supabase dashboard top bar
2. **JWT Signing Key URL** — go to Settings > JWT Keys > View key details > Discovery URL
3. **Legacy JWT secret** — go to Settings > JWT Keys > Legacy JWT Secret
4. **S3 connection details** (if using storage) — go to Storage > S3

### 2. Initialize Replace-a-base

```ts
// server.ts
import { createReplacebase } from "replace-a-base";

const replacebase = await createReplacebase({
  databaseUrl: process.env.DATABASE_URL!, // Supabase Postgres connection string
  jwksUrl: process.env.JWKS_URL!, // Supabase JWT Signing Key URL
  jwtSecret: process.env.JWT_SECRET!, // Supabase JWT secret
  // If using storage, pass Supabase S3 details
  storage: {
    s3: {
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  },
});
```

### 3. Serve with Your Framework

Replace-a-base is framework-agnostic. Pick whichever fits your stack:

**Next.js:**

Since Next.js catch-all routes are mounted under a subpath, use the `basePath` option so Replace-a-base matches routes correctly:

```ts
// app/api/[...path]/route.ts
const replacebase = await createReplacebase({
  // ...
  basePath: "/api",
});

export const GET = replacebase.fetch;
export const POST = replacebase.fetch;
export const PUT = replacebase.fetch;
export const PATCH = replacebase.fetch;
export const DELETE = replacebase.fetch;
```

Note: Next.js API routes don't support WebSockets, so Realtime won't work with this setup. If you need Realtime, run Replace-a-base as a separate backend service.

**Express:**

```ts
import express from "express";

const app = express();
app.all("/*", replacebase.toNodeHandler());
const server = app.listen(3000);
replacebase.injectWebSocket(server); // Enables Realtime (broadcast + presence)
```

**Hono / Bun / Deno / Cloudflare Workers (standard fetch):**

```ts
export default { fetch: replacebase.fetch };
```

For Realtime support on Node.js, use `@hono/node-server` to get an HTTP server you can inject WebSockets into:

```ts
import { serve } from "@hono/node-server";

const server = serve({ fetch: replacebase.fetch, port: 3000 });
replacebase.injectWebSocket(server);
```

### 4. Update Client Config

The only frontend change is pointing the Supabase client at your Replace-a-base server:

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://your-replace-a-base-server.com", // Your Replace-a-base URL
  "your-anon-key",
);
```

## Configuration Reference

| Option        | Type     | Required | Description                                              |
| ------------- | -------- | -------- | -------------------------------------------------------- |
| `databaseUrl` | `string` | Yes      | Postgres connection string                               |
| `jwtSecret`   | `string` | Yes      | Supabase legacy JWT secret (HS256 signing key)           |
| `jwksUrl`     | `string` | No       | Supabase JWT Signing Key URL (JWKS endpoint)             |
| `storage`     | `object` | No       | S3-compatible storage configuration                      |
| `basePath`    | `string` | No       | Base path prefix if served from a subpath (e.g. `"/api"`) |

## Exported API

| Export                                | Type                                   | Description                              |
| ------------------------------------- | -------------------------------------- | ---------------------------------------- |
| `replacebase.fetch`                   | `(Request) => Promise<Response>`       | Web Standard fetch handler               |
| `replacebase.toNodeHandler()`         | `(req, res) => void`                   | Node.js HTTP handler (Express, Fastify)  |
| `replacebase.injectWebSocket(server)` | `(server) => void`                     | Attach Realtime WebSocket to HTTP server |
| `replacebase.app`                     | `Hono`                                 | Raw Hono instance for advanced usage     |
| `generateKeys(jwtSecret)`             | `Promise<{ anonKey, serviceRoleKey }>` | Generate API keys from JWT secret        |

## Migration Path

Once Replace-a-base is running, you can gradually:

1. **Change Postgres provider** — move to AWS RDS, Neon, or any Postgres host. Update `databaseUrl` and your frontend keeps working.
2. **Change storage provider** — switch to AWS S3, Cloudflare R2, or any S3-compatible service. Migrate files with `rclone` and update credentials.
3. **Migrate away from the Supabase SDK** — build regular backend endpoints alongside Replace-a-base. Replace `supabase.from("posts").select()` calls with your own API. Eventually drop `@supabase/supabase-js` entirely.
