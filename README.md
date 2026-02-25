# Replacebase

Drop-in replacement for Supabase's backend. Point your existing `@supabase/supabase-js` client at your own server and everything keeps working — no client-side code changes required.

Replacebase replicates the Supabase APIs your client already talks to:

- **REST API** (`/rest/v1/*`) — PostgREST-compatible CRUD, driven by Drizzle schemas
- **Auth** (`/auth/v1/*`) — GoTrue-compatible auth (signup, signin, token refresh, user management)
- **Storage** (`/storage/v1/*`) — S3-backed file storage with the Supabase Storage API
- **Realtime** (`/realtime/v1/*`) — WebSocket-based Postgres changes

## Prerequisites

- Your existing Supabase PostgreSQL database (Replacebase connects directly to it)
- A [Drizzle](https://orm.drizzle.team/) schema describing your application tables
- Your Supabase JWT secret (found in Supabase Dashboard > Settings > API)

Replacebase makes no destructive changes to your database. It adds a few nullable columns and new tables in the `auth` schema for its internal auth layer, all of which are compatible with the existing Supabase schema.

## Installation

```bash
npm install replacebase drizzle-orm postgres
```

## Quick start

### 1. Define your Drizzle schema

Create a Drizzle schema that matches your existing Supabase tables:

```ts
// schema.ts
import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  body: text("body"),
  userId: uuid("user_id").notNull(),
  published: boolean("published").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  body: text("body").notNull(),
  postId: uuid("post_id").notNull().references(() => posts.id),
  userId: uuid("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const schema = { posts, comments };
```

### 2. Create the server

```ts
// server.ts
import { createReplacebase, generateKeys } from "replacebase";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema";

const db = drizzle(postgres(process.env.DATABASE_URL!));

const replacebase = createReplacebase({
  db,
  schema,
  jwtSecret: process.env.JWT_SECRET!, // Your Supabase JWT secret
});
```

### 3. Generate API keys

Replacebase generates its own anon and service role keys from your JWT secret. These are equivalent to the keys from your Supabase dashboard:

```ts
const keys = await generateKeys(process.env.JWT_SECRET!);
console.log(keys.anonKey);        // Use in your client
console.log(keys.serviceRoleKey); // Use for admin operations
```

### 4. Serve it

Replacebase is framework-agnostic. Pick whichever fits your stack:

**Node.js / Express:**

```ts
import express from "express";

const app = express();
app.all("/*", replacebase.toNodeHandler());
app.listen(3000);
```

**Hono / Bun / Deno / Cloudflare Workers (Web Standard `fetch`):**

```ts
export default { fetch: replacebase.fetch };
```

**With Realtime support (Node.js):**

```ts
import { serve } from "@hono/node-server";

const server = serve({ fetch: replacebase.fetch, port: 3000 });
replacebase.injectWebSocket(server);
```

### 5. Point your Supabase client at it

The only client-side change: swap the URL and use the new keys.

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "http://localhost:3000",  // Your Replacebase server
  keys.anonKey              // Generated in step 3
);

// Everything works exactly as before
const { data } = await supabase.from("posts").select("*");
const { data: user } = await supabase.auth.signUp({
  email: "user@example.com",
  password: "password123",
});
```

## Storage (optional)

To enable Supabase Storage compatibility, provide S3 configuration:

```ts
const replacebase = createReplacebase({
  db,
  schema,
  jwtSecret: process.env.JWT_SECRET!,
  storage: {
    s3: {
      endpoint: process.env.S3_ENDPOINT!,
      region: "us-east-1",
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
      forcePathStyle: true, // Required for MinIO and similar
    },
  },
});
```

Then use the standard Supabase Storage client:

```ts
await supabase.storage.from("avatars").upload("photo.png", file);
const { data } = supabase.storage.from("avatars").getPublicUrl("photo.png");
```

## RLS

Your existing Row Level Security policies continue to work. Replacebase sets the Postgres role and JWT claims on every query transaction, so `auth.uid()`, `auth.jwt()`, and role-based policies all behave identically to Supabase.

## Auth

Replacebase implements the GoTrue endpoints that `@supabase/supabase-js` uses:

- `supabase.auth.signUp()` — email/password registration
- `supabase.auth.signInWithPassword()` — email/password login
- `supabase.auth.getUser()` — fetch current user
- `supabase.auth.refreshSession()` — token refresh with rotation
- `supabase.auth.signOut()` — session revocation

Existing Supabase users are lazily migrated on first sign-in — no batch migration step needed.

## Migration checklist

1. **Create a Drizzle schema** matching your Supabase tables
2. **Deploy Replacebase** on your own server, connected to your existing database
3. **Generate new API keys** with `generateKeys()`
4. **Update your client** to point at your Replacebase URL with the new keys
5. **Verify** that auth, queries, and RLS all work as expected
6. **Remove Supabase dependency** when ready — your database and server are fully under your control

## API

### `createReplacebase(config)`

Creates a Replacebase instance.

```ts
interface ReplacebaseConfig {
  db: PostgresJsDatabase<any>;       // Drizzle database instance
  schema: Record<string, unknown>;    // Drizzle schema object
  jwtSecret: string;                  // Supabase JWT secret
  storage?: StorageConfig;            // Optional S3 config
}
```

Returns:

| Property | Type | Description |
|---|---|---|
| `fetch` | `(Request) => Promise<Response>` | Web Standard fetch handler |
| `toNodeHandler()` | `() => (req, res) => void` | Node.js HTTP handler |
| `injectWebSocket` | `(server) => void` | Add Realtime WebSocket support to a Node HTTP server |
| `app` | `Hono` | Raw Hono instance for advanced usage |

### `generateKeys(jwtSecret)`

Generates anon and service role API keys from your JWT secret.

```ts
const { anonKey, serviceRoleKey } = await generateKeys(jwtSecret);
```

## License

MIT
