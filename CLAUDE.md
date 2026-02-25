# Replacebase

## Context

Replacebase is a TypeScript library that serves as a drop-in replacement for Supabase's backend. Users plug it into their own server (Express, Hono, etc.), point their existing `@supabase/supabase-js` client at it, and everything keeps working. This enables gradual migration away from Supabase's managed platform.

Two Supabase services are replicated:

- **REST API** (`/rest/v1/*`) — PostgREST-compatible CRUD, derived from Drizzle schemas
- **Auth** (`/auth/v1/*`) — GoTrue-compatible auth API, using Better Auth internally

Key constraints: framework-agnostic (Hono internally, Web Standard `fetch` handler exported), RLS enforced at Postgres level, no schema changes required to existing Supabase database (only additive tables/columns), only `jwtSecret` needed in config (API keys validated from client requests).

Use Git to manage the project and make small commits regularly. Use conventional commit messages.

---

## Architecture

```
@supabase/supabase-js client
  │
  │  HTTP (apikey + Authorization headers)
  │
Replacebase (Hono router)
  ├── API key middleware (validates JWTs via jwtSecret)
  ├── /rest/v1/* (PostgREST-compatible)
  │     Parse query params → Drizzle query → SET ROLE + set_config → execute
  └── /auth/v1/* (GoTrue-compatible)
        Translate requests → Better Auth auth.api.* → issue Supabase-compatible JWTs
  │
PostgreSQL (same DB, untouched schema + a few additive tables)
```

---

## File Structure

```
src/
  index.ts              # Public API: createReplacebase(), generateKeys()
  types.ts              # Core interfaces (ReplacebaseConfig, etc.)
  server.ts             # Hono app factory, route mounting
  middleware/
    api-key.ts          # JWT validation of apikey + Authorization headers
    cors.ts             # CORS for Supabase client compat
  rest/
    index.ts            # REST router (Hono sub-app for /rest/v1)
    query-builder.ts    # Parsed AST + SchemaRegistry → Drizzle queries
    schema-registry.ts  # Runtime Drizzle schema introspection + lookup cache
    response.ts         # Response formatting (JSON array, single object, Content-Range)
    rls.ts              # SET LOCAL ROLE + set_config wrapper (transaction-scoped)
    parser/             # PostgREST query string parsers (select, filter, order, pagination, prefer)
  auth/
    index.ts            # Auth router (Hono sub-app for /auth/v1) with GoTrue-compatible endpoints
    jwt.ts              # Supabase-compatible JWT creation/verification (jose + HS256)
    refresh-tokens.ts   # Refresh token CRUD against auth.refresh_tokens
    user-response.ts    # DB user → GoTrue response shape formatter
  db/
    schema.ts           # Drizzle schema for auth tables (Supabase-compat + BA additions)
test/
  setup.ts              # PGlite + schema + roles + RLS policies
  helpers.ts            # createTestEnv(), user factories, JWT helpers
  fixtures/             # Test app tables, relations, RLS policies, seed data
  rest/                 # REST API integration tests (select, filter, insert, update, delete, etc.)
  auth/                 # Auth flow integration tests (signup, signin, token refresh, etc.)
```

---

## Key Design Decisions

### API Key Validation (no keys in config)

The backend only needs `jwtSecret`. The Supabase client sends the anon key as both `apikey` and `Authorization` headers. Both are JWTs signed with the same secret. The middleware:

1. Verifies `apikey` header as JWT → extracts `role` claim (`anon` or `service_role`)
2. Checks if `Authorization` header contains a different JWT (user session token)
3. If yes, verifies it → role becomes `authenticated`, extracts `sub` as user ID
4. If no, uses the apikey's role

A `generateKeys(jwtSecret)` utility generates anon + service_role key JWTs for users during setup.

### Better Auth Integration

**Challenge:** Better Auth's schema differs fundamentally from Supabase's (passwords in `account` vs `auth.users.encrypted_password`, `emailVerified` boolean vs `email_confirmed_at` timestamp, cookie sessions vs JWT + refresh tokens).

**Approach:**

1. **Better Auth uses `auth.users`** as its user table, with 3 added nullable columns (`name`, `email_verified`, `image`). These are additive, non-breaking changes.
2. **Better Auth gets new tables** in the `auth` schema: `accounts`, `ba_sessions`, `verifications`. These don't conflict with existing Supabase tables.
3. **Password hashing** configured for bcrypt (matching Supabase's format).
4. **GoTrue-compatible endpoints** call `auth.api.*` internally — Better Auth's own HTTP endpoints are never exposed.
5. **JWT issuance** handled by us using `jose` with HS256 and exact Supabase claim structure (`sub`, `role`, `aal`, `session_id`, `app_metadata`, `user_metadata`, etc.).
6. **Refresh tokens** managed by us in `auth.refresh_tokens` (Supabase's existing table), with rotation and revocation chain tracking.
7. **Better Auth's cookie sessions** are a side effect that we ignore — our JWT-based auth is authoritative.
8. **Lazy migration** for existing Supabase users: on first sign-in, verify against `auth.users.encrypted_password`, then create a Better Auth `account` record.

### RLS Enforcement

Each REST query runs inside a transaction that:

```sql
SELECT set_config('role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"sub":"...","role":"..."}', true);
SELECT set_config('request.jwt.claim.sub', 'user-uuid', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
```

This makes existing `auth.uid()` and `auth.jwt()` RLS policies work without changes.

### Framework-Agnostic Design

Hono is used as the internal router. The public API exports:

- `replacebase.fetch` — Web Standard `(Request) => Promise<Response>` (works in Bun, Deno, CF Workers)
- `replacebase.toNodeHandler()` — Node.js `(IncomingMessage, ServerResponse) => void` (works in Express, Fastify)
- `replacebase.app` — raw Hono instance for advanced usage

---

## Testing

- **PGlite** (`@electric-sql/pglite`) as in-process PostgreSQL (supports RLS, roles, set_config)
- **Vitest** as test runner
- **Real `@supabase/supabase-js`** client for integration tests
- **HTTP server per test suite** via `@hono/node-server` on random port
