# Replacebase

Replacebase is a library and tool to help you migrate away from Supabase over to backend infrastructure that you control. It's a simple Typescript library that wraps your Postgres database and S3 storage, and exposes a Supabase-compatible API. This means you don't have to change any frontend logic and can unify all your backend code for a simpler architecture.

There are many reason to use Replacebase:

- Host your backend where you like, like AWS or [Specific](https://specific.dev)
- Reduce your dependency on Supabase services and their uptime
- Use a better database and storage provider, like Planetscale or [Specific](https://specific.dev)
- Gradually migrate away from using Supabase SDKs to a more flexible backend architecture that you control
- Replace inflexible Supabase services with better alternatives, like [Better Auth](https://better-auth.com)

Replacebase currently supports and replaces:

- REST API (can connect to any Postgres database)
- Auth (built on [Better Auth](https://better-auth.com))
- Storage (can connect to any S3-compatible service)
- Realtime (broadcast and presence)

## Installation

```bash
npm install @specific.dev/replacebase
```

## Getting started

### 1. Get your Supabase details

For this guide, we will use your existing Postgres database and Supabase-provided S3-storage and connect Replacebase.

Sign in to your Supabase account and retrieve the following:

1. Your Postgres connection string (click "Connect" in the top bar)

2. Your legacy JWT secret (go to "Settings" -> "JWT Keys" -> "Legacy JWT Secret")

3. If using storage, your S3 connection details and access key (go to "Storage" -> "S3")

### 2. Serve up Replacebase

On your backend, initialise Replacebase with the details from step 1.

_If you don't have anywhere to host your backend yet, we recommend [Specific](https://specific.dev)_

```ts
// server.ts
import { createReplacebase } from "replacebase";

const replacebase = createReplacebase({
  databaseUrl: process.env.DATABASE_URL!, // Supabase Postgres connection string
  jwtSecret: process.env.JWT_SECRET!, // Supabase JWT secret
  // If using storage, pass Supabase S3 details
  storage: {
    s3: {
      endpoint: process.env.S3_ENDPOINT!.
      region: process.env.S3_REGION!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!
    }
  }
});
```

Next you need to serve up the APIs that Replacebase exposes. Replacebase is framework-agnostic and works with any web server. Pick whichever fits your stack:

**Next.js**

TODO: use Next.js API support, simple endpoint

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

### 3. Update your client config

The only change you need to make on your frontend is to connect to your own backend with Replacebase instead of Supabase.

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  -"https://xyz.supabase.co",
  +"http://replacebase-api.spcf.app", // Insert wherever your Replacebase is served from
  // ...
);
```

That's it, test it out!

## Next steps for migration

Replacebase is designed to be a stepping stone to a larger migratiopn away from Supabase. Depending on your goals, you probably want to continue your migration by doing the following:

### Change Postgres provider

TODO

### Change storage provider

TODO

### Migrate away from the Supabase framework and API

TODO: build regular backend API, gradually replace Supabase endpoints and update client

## License

MIT
