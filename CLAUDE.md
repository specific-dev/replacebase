# Replacebase — Implementation Plan

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
replacebase/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                       # Public API: createReplacebase(), generateKeys()
    types.ts                       # Core interfaces (ReplacebaseConfig, etc.)
    server.ts                      # Hono app factory, route mounting
    middleware/
      api-key.ts                   # JWT validation of apikey + Authorization headers
      cors.ts                      # CORS for Supabase client compat
    rest/
      index.ts                     # REST router (Hono sub-app for /rest/v1)
      parser/
        types.ts                   # AST types: ParsedSelect, FilterCondition, etc.
        select.ts                  # Recursive descent parser for select param
        filter.ts                  # PostgREST operator parser (eq, neq, gt, in, or, etc.)
        order.ts                   # Order param parser
        pagination.ts              # limit/offset + Range header
        prefer.ts                  # Prefer header parser
      query-builder.ts             # Parsed AST + SchemaRegistry → Drizzle queries
      schema-registry.ts           # Runtime Drizzle schema introspection + lookup cache
      response.ts                  # Response formatting (JSON array, single object, Content-Range)
      rls.ts                       # SET LOCAL ROLE + set_config wrapper (transaction-scoped)
    auth/
      index.ts                     # Auth router (Hono sub-app for /auth/v1)
      better-auth-config.ts        # Better Auth instance factory with schema mapping
      jwt.ts                       # Supabase-compatible JWT creation/verification (jose + HS256)
      refresh-tokens.ts            # Refresh token CRUD against auth.refresh_tokens
      user-response.ts             # DB user → GoTrue response shape formatter
      migration.ts                 # Lazy migration: create BA account for existing Supabase users
      endpoints/
        signup.ts                  # POST /auth/v1/signup
        token.ts                   # POST /auth/v1/token (password + refresh grants)
        user.ts                    # GET + PUT /auth/v1/user
        logout.ts                  # POST /auth/v1/logout
        recover.ts                 # POST /auth/v1/recover
        verify.ts                  # POST /auth/v1/verify
        health.ts                  # GET /auth/v1/health
        settings.ts                # GET /auth/v1/settings
        admin/
          users.ts                 # Admin user CRUD (service_role only)
    db/
      schema.ts                    # Drizzle schema for auth tables (Supabase-compat + BA additions)
  test/
    setup.ts                       # PGlite + schema + roles + RLS policies
    helpers.ts                     # createTestEnv(), user factories, JWT helpers
    fixtures/
      schema.ts                    # Test app tables (posts, comments, profiles, categories)
      relations.ts                 # Drizzle relations for test schema
      policies.ts                  # RLS policy SQL for test tables
      seed.ts                      # Seed data helpers
    rest/
      select.test.ts
      filter.test.ts
      insert.test.ts
      update.test.ts
      delete.test.ts
      embedding.test.ts
      rls.test.ts
      pagination.test.ts
    auth/
      signup.test.ts
      signin.test.ts
      token-refresh.test.ts
      user.test.ts
      logout.test.ts
      existing-user.test.ts        # Existing Supabase users with JWT tokens
    parser/
      select-parser.test.ts        # Pure unit tests (no DB)
      filter-parser.test.ts
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

**Challenge:** Better Auth's schema differs fundamentally from Supabase's:

- BA stores passwords in `account` table; Supabase in `auth.users.encrypted_password`
- BA expects `emailVerified` (boolean); Supabase has `email_confirmed_at` (timestamp)
- BA expects `name` and `image` columns; Supabase `auth.users` doesn't have these
- BA uses cookie-based sessions; Supabase uses JWT + refresh tokens

**Approach:**

1. **Better Auth uses `auth.users`** as its user table, with 3 added nullable columns (`name`, `email_verified`, `image`). These are additive, non-breaking changes applied during setup.
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

## Implementation Phases

### Phase 0: Project Scaffolding

- `package.json` with deps: `hono`, `drizzle-orm`, `better-auth`, `jose`, `bcryptjs`, `@hono/node-server`
- Dev deps: `vitest`, `@electric-sql/pglite`, `@supabase/supabase-js`, `typescript`, `drizzle-kit`
- `tsconfig.json` (strict, ESM, `moduleResolution: "bundler"`)
- `vitest.config.ts`
- Basic export structure in `src/index.ts`

### Phase 1: Schema Registry + RLS Context

- `SchemaRegistry` class: iterates Drizzle table exports, calls `getTableConfig()`/`getTableColumns()`, builds `TableMeta` map (table name, columns, foreign keys, relations)
- `withRLS(db, role, claims, fn)`: wraps query execution in a transaction with `set_config` calls
- **Test:** PGlite with a simple table + RLS policy, verify `withRLS` applies role correctly

### Phase 2: PostgREST Query Parser (parallel with Phase 1)

- **Select parser:** recursive descent handling `*`, columns, aliases, casts, embeddings with `()`, `!inner`, `!hint`, `...spread`
- **Filter parser:** split on first `.` for `[not.]operator.value`, handle `in.(...)`, `is.null/true/false`, `or=(...)` / `and=(...)` grouping
- **Order parser:** split on commas, parse `.asc/.desc/.nullsfirst/.nullslast`
- **Pagination parser:** `limit`/`offset` params + `Range` header
- **Prefer parser:** `return`, `count`, `resolution`, `missing`
- **Test:** Pure unit tests for each parser, no database needed

### Phase 3: Query Builder

- Convert parsed AST → Drizzle queries using `$dynamic()`, `eq()`, `ne()`, `gt()`, `like()`, `inArray()`, ` sql` `` for advanced operators
- Operator map: `eq`→`eq()`, `neq`→`ne()`, `gt`→`gt()`, `like`→`like()` (with `*`→`%`), `cs`→`` sql`@>` ``, etc.
- Embedding: collect parent IDs, execute `WHERE fk IN (...)` query, stitch results in JS
- Mutations: `db.insert().values()`, `db.update().set().where()`, `db.delete().where()`, `.onConflictDoUpdate()` for upsert, `.returning()` for `Prefer: return=representation`
- **Test:** Integration tests against PGlite with real tables and data

### Phase 4: REST Router

- Hono sub-app with `GET/POST/PATCH/DELETE /:table` routes
- Each route: parse params → build query → `withRLS()` → execute → format response
- Response formatting: JSON array (default), single object (`Accept: application/vnd.pgrst.object+json`), `Content-Range` header for counts
- Status codes: 200 GET, 201 POST, 204 (no body), matching PostgREST error format
- **Test:** End-to-end with `@supabase/supabase-js` `.from().select().eq()` etc.

### Phase 5: API Key Middleware

- Validate `apikey` header JWT, extract `role` claim
- Check `Authorization` header for user JWT (different from apikey)
- Set `role`, `claims`, `userId` on Hono context
- `generateKeys(jwtSecret)` utility function
- **Test:** Verify role extraction with anon key, service key, and user JWT

### Phase 6: Auth Schema + Better Auth Config (parallel with Phases 2-4)

- Drizzle schema for `auth.users` (full Supabase columns + BA additions), `auth.accounts`, `auth.ba_sessions`, `auth.verifications`, `auth.refresh_tokens`, `auth.identities`
- Better Auth config: Drizzle adapter with schema mapping, bcrypt password hash/verify, `modelName`/`fields` mappings, UUID ID generation
- **Test:** BA signup/signin creates correct records in auth schema

### Phase 7: JWT + Refresh Token Management

- `createAccessToken()`: HS256 JWT with exact Supabase claims (`sub`, `role`, `aal`, `session_id`, `app_metadata`, `user_metadata`, `email`, `phone`, `is_anonymous`, `amr`)
- `verifyAccessToken()`: JWT verification with `jose`
- `createRefreshToken()`: insert into `auth.refresh_tokens`
- `rotateRefreshToken()`: revoke old, create new with `parent` reference, detect reuse → revoke family
- **Test:** JWT decodes correctly, refresh rotation works, replay detection

### Phase 8: GoTrue-Compatible Auth Endpoints

- `/signup` — call BA `signUpEmail()`, update `auth.users` with Supabase fields, create identity, optionally issue tokens
- `/token?grant_type=password` — try BA sign-in, fallback to `auth.users.encrypted_password` with lazy migration, issue JWT + refresh token
- `/token?grant_type=refresh_token` — rotate token, issue new JWT
- `/user` GET — decode JWT, fetch user, return GoTrue format
- `/user` PUT — update user metadata/email/password
- `/logout` — revoke refresh tokens for session
- `/recover`, `/verify` — password recovery flow
- `/health`, `/settings` — system endpoints
- `/admin/users` — CRUD behind service_role validation
- User response formatter: DB row → GoTrue JSON shape
- **Test:** Full flows with `supabase.auth.signUp()`, `.signInWithPassword()`, `.getUser()`, `.signOut()`

### Phase 9: Server Assembly

- `createReplacebase(config)` — creates Hono app, mounts CORS, API key middleware, REST + Auth routers
- Returns `{ fetch, toNodeHandler(), app }`
- `toNodeHandler()` uses `@hono/node-server`'s `getRequestListener`
- **Test:** End-to-end: start server, create Supabase client, signup → signin → CRUD with RLS → signout

### After completion

Output <promise>COMPLETE</promise> when the project is fully implemented and tested

---

## Testing Strategy

### Test Infrastructure

- **PGlite** (`@electric-sql/pglite`) as in-process PostgreSQL — supports RLS, CREATE SCHEMA, CREATE ROLE, SET ROLE, set_config, CREATE FUNCTION
- **Vitest** as test runner
- **Real `@supabase/supabase-js`** client for integration tests
- **HTTP server per test suite** via `@hono/node-server` on random port

### Test Schema (single Drizzle schema covering all cases)

- `posts` (id, title, body, user_id, published, created_at) — FK to auth.users
- `comments` (id, body, post_id, user_id, created_at) — FK to posts + auth.users
- `profiles` (id, username, bio, avatar_url) — 1:1 with auth.users
- `categories` (id, name, description) — standalone
- `post_categories` (post_id, category_id) — junction table for many-to-many
- RLS policies: users CRUD own posts/comments, anyone reads published posts, users access own profile

### Test Setup Pattern

```typescript
// Per test suite:
const pglite = new PGlite();
// Create auth schema, roles (anon, authenticated, service_role), tables, RLS policies, auth.uid() function
const replacebase = createReplacebase({ db, schema, jwtSecret: "test-secret" });
const server = serve({ fetch: replacebase.fetch, port: 0 });
const supabase = createClient(`http://localhost:${port}`, anonKey);
```

### Key Test Scenarios

1. **Existing Supabase users**: seed `auth.users` with bcrypt passwords, sign in via Supabase client, verify lazy migration creates BA account
2. **RLS enforcement**: insert data as user A, verify user B cannot see it, verify service_role can see all
3. **Full auth flow**: signup → signin → get user → update user → refresh token → signout
4. **REST CRUD**: insert, select with filters, update with conditions, delete, upsert
5. **Resource embedding**: `select=*,comments(*)`, nested embedding, `!inner` joins
6. **All filter operators**: eq, neq, gt, gte, lt, lte, like, ilike, in, is, cs, cd, ov, or, and, not
7. **Pagination**: limit/offset, Content-Range with exact count

---

## Risks and Mitigations

| Risk                                           | Mitigation                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| PGlite SET ROLE / RLS edge cases               | Test immediately in Phase 1; fallback to Docker Postgres for CI if needed |
| Better Auth Drizzle adapter with pgSchema()    | Test early in Phase 6; fallback to search_path approach                   |
| BA session creation overhead (unused sessions) | Configure short expiry or periodic cleanup; minor DB overhead             |
| PostgREST syntax coverage gaps                 | Start with common operations, document unsupported features, iterate      |
| Supabase JS client version compat              | Pin to specific version in tests, support latest stable                   |
| Refresh token replay attacks                   | Implement token family revocation (track `parent`, revoke chain on reuse) |
