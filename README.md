# Replacebase

Replacebase is a library to help you migrate away from [Supabase](https://supabase.com) over to backend infrastructure that you control. It's a simple Typescript library that wraps your Postgres database and S3 storage, and exposes a Supabase-compatible API. This means you don't have to change any frontend logic and can unify all your backend code for a simpler architecture.

There are many reason to use Replacebase:

- Host your backend where you like, for example on AWS or [Specific](https://specific.dev)
- Reduce your dependency on Supabase services and their uptime
- Use a better database and storage provider, like [Planetscale](https://planetscale.com) or [Specific](https://specific.dev)
- Gradually migrate away from using Supabase SDKs to a more flexible backend architecture that you control
- Replace inflexible Supabase services with better alternatives, like [Better Auth](https://better-auth.com)

Replacebase currently supports and replaces:

- REST API (can connect to any Postgres database)
- Auth (built on [Better Auth](https://better-auth.com))
- Storage (can connect to any S3-compatible service)
- Realtime (broadcast and presence)

_This is an early-stage project, use it with care and test thoroughly before using in production_

## Installation

```bash
npm install @specific.dev/replacebase
```

## Getting started

For this guide, we will use your existing Postgres database and Supabase-provided S3-storage and connect Replacebase.

We also offer a skill to let your coding agent help with the migration: `npx skills add specific-dev/replacebase`

### 1. Get your Supabase details

Sign in to your [Supabase account](https://supabase.com/dashboard) and retrieve the following:

1. Your Postgres connection string (click "Connect" in the top bar)

2. Your JWT Signing Key URL (go to "Settings" -> "JWT Keys" -> "View key details" -> "Discovery URL")

3. Your legacy JWT secret (go to "Settings" -> "JWT Keys" -> "Legacy JWT Secret")

4. If using storage, your S3 connection details and access key (go to "Storage" -> "S3")

### 2. Serve up Replacebase

On your backend, initialise Replacebase with the details from step 1.

_If you don't have anywhere to host your backend yet, we recommend [Specific](https://specific.dev)_

```ts
// server.ts
import { createReplacebase } from "replacebase";

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

Next you need to serve up the APIs that Replacebase exposes. Replacebase is framework-agnostic and works with any web server. Pick whichever fits your stack:

<details>
<summary><strong>Next.js</strong></summary>

Since Next.js catch-all routes are mounted under a subpath, use the `basePath` option so Replacebase matches routes correctly:

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

Note: Next.js API routes don't support WebSockets, so Realtime won't work with this setup. If you need Realtime, run Replacebase as a separate backend service.

</details>

<details>
<summary><strong>Express</strong></summary>

```ts
import express from "express";

const app = express();
app.all("/*", replacebase.toNodeHandler());
const server = app.listen(3000);
replacebase.injectWebSocket(server); // Enables Realtime (broadcast + presence)
```

</details>

<details>
<summary><strong>Hono / Bun / Deno / Cloudflare Workers (standard fetch)</strong></summary>

```ts
export default { fetch: replacebase.fetch };
```

For Realtime support on Node.js, use `@hono/node-server` to get an HTTP server you can inject WebSockets into:

```ts
import { serve } from "@hono/node-server";

const server = serve({ fetch: replacebase.fetch, port: 3000 });
replacebase.injectWebSocket(server);
```

</details>

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

Replacebase is designed to be a stepping stone to a larger migration away from Supabase. Depending on your goals, you probably want to continue your migration by doing the following:

### Change Postgres provider

Since Replacebase connects to any standard Postgres database, you can move off Supabase's hosted Postgres whenever you're ready. Spin up a database on AWS RDS, [Specific](https://specific.dev), or any other provider, migrate your data with `pg_dump`/`pg_restore`, and update your `DATABASE_URL`. Your frontend code will keep working without changes.

### Change storage provider

Replacebase works with any S3-compatible storage service. You can switch from Supabase's built-in storage to AWS S3, Cloudflare R2, [Specific](https://specific.dev), or any other provider simply by updating your credentials. Migrate existing files with a tool like `rclone` or the AWS CLI.

### Migrate away from the Supabase SDK

Once Replacebase is running, you can start building regular backend API endpoints alongside it. For example, replace a Supabase client query like `supabase.from("posts").select()` with a call to your own `/api/posts` endpoint. With Replacebase, you can do this gradually to move towards a more flexible backend design that better fits your product. Eventually, you can drop `@supabase/supabase-js` and Replacebase from your stack entirely!

## License

MIT
