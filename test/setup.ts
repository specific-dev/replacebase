import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { testSchema } from "./fixtures/schema";

export async function createTestDb() {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema: testSchema });

  // Create auth schema and tables
  await createAuthTables(db);

  // Create storage schema and tables
  await createStorageTables(db);

  // Create app tables
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      body TEXT,
      user_id UUID NOT NULL,
      published BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      search_vector tsvector,
      tags text[]
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      body TEXT NOT NULL,
      post_id UUID NOT NULL REFERENCES posts(id),
      user_id UUID NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL,
      bio TEXT,
      avatar_url TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      name TEXT NOT NULL,
      description TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS post_categories (
      post_id UUID NOT NULL REFERENCES posts(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      PRIMARY KEY (post_id, category_id)
    )
  `);

  // Create a view that joins posts with profiles
  await db.execute(sql`
    CREATE OR REPLACE VIEW post_details AS
    SELECT
      p.id,
      p.title,
      p.body,
      p.user_id,
      p.published,
      p.created_at,
      pr.username AS author_name
    FROM posts p
    LEFT JOIN profiles pr ON p.user_id = pr.id
  `);

  return { pglite, db };
}

export async function seedTestData(db: any) {
  const userId1 = "11111111-1111-1111-1111-111111111111";
  const userId2 = "22222222-2222-2222-2222-222222222222";

  // Insert profiles
  await db.execute(sql`
    INSERT INTO profiles (id, username, bio) VALUES
      (${userId1}, 'alice', 'Alice bio'),
      (${userId2}, 'bob', 'Bob bio')
  `);

  // Insert posts
  const postResult = await db.execute(sql`
    INSERT INTO posts (id, title, body, user_id, published) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'First Post', 'Hello world', ${userId1}, true),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Second Post', 'Another post', ${userId1}, false),
      ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Third Post', 'Bob post', ${userId2}, true)
    RETURNING id
  `);

  // Insert comments
  await db.execute(sql`
    INSERT INTO comments (id, body, post_id, user_id) VALUES
      ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Great post!', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ${userId2}),
      ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Thanks!', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ${userId1}),
      ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Nice one', 'cccccccc-cccc-cccc-cccc-cccccccccccc', ${userId1})
  `);

  // Insert categories
  await db.execute(sql`
    INSERT INTO categories (id, name, description)
    OVERRIDING SYSTEM VALUE
    VALUES
      (1, 'Tech', 'Technology posts'),
      (2, 'Life', 'Life posts')
  `);

  // Link posts to categories
  await db.execute(sql`
    INSERT INTO post_categories (post_id, category_id) VALUES
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1),
      ('cccccccc-cccc-cccc-cccc-cccccccccccc', 1),
      ('cccccccc-cccc-cccc-cccc-cccccccccccc', 2)
  `);

  // Populate search vectors and tags for advanced filter tests
  await db.execute(sql`
    UPDATE posts SET
      search_vector = to_tsvector(title || ' ' || coalesce(body, '')),
      tags = CASE title
        WHEN 'First Post' THEN ARRAY['tech', 'hello']::text[]
        WHEN 'Second Post' THEN ARRAY['life']::text[]
        WHEN 'Third Post' THEN ARRAY['tech', 'life']::text[]
      END
  `);

  return { userId1, userId2 };
}

async function createAuthTables(db: any) {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS auth`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      instance_id UUID,
      aud TEXT DEFAULT 'authenticated',
      role TEXT DEFAULT 'authenticated',
      email TEXT UNIQUE,
      encrypted_password TEXT,
      email_confirmed_at TIMESTAMPTZ,
      invited_at TIMESTAMPTZ,
      confirmation_token TEXT,
      confirmation_sent_at TIMESTAMPTZ,
      recovery_token TEXT,
      recovery_sent_at TIMESTAMPTZ,
      email_change_token_new TEXT,
      email_change TEXT,
      email_change_sent_at TIMESTAMPTZ,
      last_sign_in_at TIMESTAMPTZ,
      raw_app_meta_data JSONB,
      raw_user_meta_data JSONB,
      is_super_admin BOOLEAN,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      phone TEXT,
      phone_confirmed_at TIMESTAMPTZ,
      phone_change TEXT,
      phone_change_token TEXT,
      phone_change_sent_at TIMESTAMPTZ,
      email_change_token_current TEXT,
      email_change_confirm_status INTEGER DEFAULT 0,
      banned_until TIMESTAMPTZ,
      reauthentication_token TEXT,
      reauthentication_sent_at TIMESTAMPTZ,
      is_sso_user BOOLEAN DEFAULT false,
      deleted_at TIMESTAMPTZ,
      is_anonymous BOOLEAN DEFAULT false,
      name TEXT,
      email_verified BOOLEAN,
      image TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
      id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      instance_id UUID,
      token TEXT UNIQUE,
      user_id TEXT,
      revoked BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      parent TEXT,
      session_id UUID
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth.identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_id TEXT NOT NULL,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      identity_data JSONB,
      provider TEXT NOT NULL,
      last_sign_in_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth.sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      factor_id UUID,
      aal TEXT,
      not_after TIMESTAMPTZ,
      refreshed_at TIMESTAMPTZ,
      user_agent TEXT,
      ip INET,
      tag TEXT
    )
  `);
}

async function createStorageTables(db: any) {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS storage`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      owner UUID,
      owner_id TEXT,
      public BOOLEAN DEFAULT false,
      file_size_limit BIGINT,
      allowed_mime_types TEXT[],
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT REFERENCES storage.buckets(id),
      name TEXT,
      owner UUID,
      owner_id TEXT,
      metadata JSONB,
      user_metadata JSONB,
      version TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      last_accessed_at TIMESTAMPTZ,
      CONSTRAINT bucketid_objname UNIQUE (bucket_id, name)
    )
  `);
}
