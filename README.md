# Replacebase

Drop-in replacement for Supabase's backend. Plug it into your own server, point your existing `@supabase/supabase-js` client at it, and everything keeps working. Your client code doesn't change — only the URL and API keys.

## Why

Supabase is great for getting started, but at some point you may want full control over your backend: self-host, customize behavior, avoid vendor lock-in. Replacebase gives you that migration path without rewriting your frontend. It implements the same HTTP APIs that `@supabase/supabase-js` talks to — REST, Auth, Storage, and Realtime — so your client keeps working as-is.

## What you need

- Your existing Supabase PostgreSQL database (Replacebase connects directly to it)
- A [Drizzle](https://orm.drizzle.team/) schema describing your application tables
- Your Supabase JWT secret (found in Dashboard > Settings > API)

Replacebase makes no destructive changes to your database. It only adds a few nullable columns and new tables in the `auth` schema, all compatible with the existing Supabase schema.

## Installation

```bash
npm install replacebase drizzle-orm postgres
```

## Getting started

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

Replacebase generates its own anon and service role keys from your JWT secret. These replace the keys from your Supabase dashboard:

```ts
const keys = await generateKeys(process.env.JWT_SECRET!);
console.log(keys.anonKey);        // Replaces your Supabase anon key
console.log(keys.serviceRoleKey); // Replaces your Supabase service role key
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

### 5. Update your client config

The only change on the client side is two strings — the URL and the key:

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
- "https://xyz.supabase.co",     // Old: Supabase-hosted
- process.env.SUPABASE_ANON_KEY  // Old: Supabase dashboard key
+ "http://localhost:3000",        // New: your Replacebase server
+ process.env.REPLACEBASE_ANON_KEY // New: generated in step 3
);
```

Everything else — queries, auth, storage, realtime — works without changes.

## Storage

To use `supabase.storage` calls, provide S3 configuration. Any S3-compatible service works (AWS S3, MinIO, Cloudflare R2, etc.):

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

## What keeps working

- **Queries** — `.from("table").select()`, `.insert()`, `.update()`, `.delete()`, filters, ordering, pagination, embedded resources
- **Auth** — `.auth.signUp()`, `.auth.signInWithPassword()`, `.auth.getUser()`, `.auth.refreshSession()`, `.auth.signOut()`
- **Row Level Security** — your existing RLS policies, `auth.uid()`, `auth.jwt()`, and role-based access all work identically
- **Storage** — `.storage.from("bucket").upload()`, `.download()`, `.getPublicUrl()`
- **Realtime** — `.channel("table").on("postgres_changes", ...)`
- **Existing users** — users already in your `auth.users` table are lazily migrated on their first sign-in, no batch migration needed

## Migration checklist

1. **Create a Drizzle schema** matching your Supabase tables
2. **Deploy Replacebase** on your own server, connected to your existing database
3. **Generate API keys** with `generateKeys()`
4. **Update your client** — swap the URL and API key
5. **Verify** everything works as expected
6. **Done** — your database and server are fully under your control

## License

MIT
