---
name: replacebase
description: Replacebase integration skill for migrating away from Supabase. Use this skill when setting up Replacebase, configuring a Supabase-compatible backend, or migrating from Supabase to self-hosted infrastructure. Triggers on tasks involving Supabase migration, Replacebase setup, or replacing Supabase services with self-hosted alternatives.
license: MIT
metadata:
  author: specific
  version: "1.0.0"
---

# Replacebase

Replacebase is a TypeScript library that serves as a drop-in replacement for Supabase's backend. It wraps your Postgres database and S3 storage, and exposes a Supabase-compatible API. This means you don't have to change any frontend logic and can unify all your backend code for a simpler architecture.

## When to Apply

- Setting up a new Replacebase instance to replace Supabase
- Migrating an existing app from Supabase to self-hosted infrastructure
- Configuring REST API, Auth, Storage, or Realtime to work with Replacebase
- Updating `@supabase/supabase-js` client config to point at Replacebase
- Choosing a hosting provider or framework integration for Replacebase

## What Replacebase Supports

| Service  | Description                                       |
| -------- | ------------------------------------------------- |
| REST API | PostgREST-compatible CRUD against any Postgres DB |
| Auth     | GoTrue-compatible auth API, built on Better Auth  |
| Storage  | S3-compatible file storage                        |
| Realtime | Broadcast and presence over WebSockets            |

## Installation

```bash
npm install @specific.dev/replacebase
```

## Setup

### 1. Gather Supabase Details

You need the following from your Supabase project:

1. **Postgres connection string** — click "Connect" in the Supabase dashboard top bar
2. **JWT Signing Key URL** — go to Settings > JWT Keys > View key details > Discovery URL
3. **Legacy JWT secret** — go to Settings > JWT Keys > Legacy JWT Secret
4. **S3 connection details** (if using storage) — go to Storage > S3

### 2. Initialize Replacebase

```ts
import { createReplacebase } from "@specific.dev/replacebase";

const replacebase = await createReplacebase({
  databaseUrl: process.env.DATABASE_URL!,
  jwksUrl: process.env.JWKS_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  // Optional: S3 storage config
  storage: {
    s3: {
      endpoint: process.env.S3_ENDPOINT!,
      region: process.env.S3_REGION!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  },
  // Optional: Set if served from a subpath (like with Next.js)
  basePath: "/",
});
```

### 3. Serve with Your Framework

Replacebase is framework-agnostic. Pick whichever fits your stack:

**Next.js:**

```ts
// app/api/[...path]/route.ts
export const GET = replacebase.fetch;
export const POST = replacebase.fetch;
export const PUT = replacebase.fetch;
export const PATCH = replacebase.fetch;
export const DELETE = replacebase.fetch;
```

Note: Next.js API routes don't support WebSockets, so Realtime won't work. Run Replacebase as a separate service if you need Realtime.

**Express:**

```ts
import express from "express";

const app = express();
app.all("/*", replacebase.toNodeHandler());
const server = app.listen(3000);
replacebase.injectWebSocket(server); // Enables Realtime
```

**Hono / Bun / Deno / Cloudflare Workers:**

```ts
export default { fetch: replacebase.fetch };
```

For Realtime on Node.js with Hono:

```ts
import { serve } from "@hono/node-server";

const server = serve({ fetch: replacebase.fetch, port: 3000 });
replacebase.injectWebSocket(server);
```

### 4. Update Client Config

The only frontend change is pointing the Supabase client at your Replacebase server:

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://your-replacebase-server.com", // Your Replacebase URL
  "your-anon-key",
);
```

## Configuration Reference

| Option        | Type       | Required | Description                                        |
| ------------- | ---------- | -------- | -------------------------------------------------- |
| `databaseUrl` | `string`   | Yes      | Postgres connection string                         |
| `jwtSecret`   | `string`   | Yes      | Supabase legacy JWT secret (HS256 signing key)     |
| `jwksUrl`     | `string`   | No       | Full URL to Supabase JWKS endpoint                 |
| `storage`     | `object`   | No       | S3-compatible storage configuration                |
| `schemas`     | `string[]` | No       | Postgres schemas to expose (default: `["public"]`) |

## Exported API

| Export                                | Type                                   | Description                              |
| ------------------------------------- | -------------------------------------- | ---------------------------------------- |
| `replacebase.fetch`                   | `(Request) => Promise<Response>`       | Web Standard fetch handler               |
| `replacebase.toNodeHandler()`         | `(req, res) => void`                   | Node.js HTTP handler (Express, Fastify)  |
| `replacebase.injectWebSocket(server)` | `(server) => void`                     | Attach Realtime WebSocket to HTTP server |
| `replacebase.app`                     | `Hono`                                 | Raw Hono instance for advanced usage     |
| `generateKeys(jwtSecret)`             | `Promise<{ anonKey, serviceRoleKey }>` | Generate API keys from JWT secret        |

## Migration Path

Once Replacebase is running, you can gradually:

1. **Change Postgres provider** — move to AWS RDS, Neon, or any Postgres host. Update `databaseUrl` and your frontend keeps working.
2. **Change storage provider** — switch to AWS S3, Cloudflare R2, or any S3-compatible service. Migrate files with `rclone` and update credentials.
3. **Migrate away from the Supabase SDK** — build regular backend endpoints alongside Replacebase. Replace `supabase.from("posts").select()` calls with your own API. Eventually drop `@supabase/supabase-js` entirely.
