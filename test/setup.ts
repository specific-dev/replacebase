import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { testSchema } from "./fixtures/schema.js";

export async function createTestDb() {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema: testSchema });

  // Create tables
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      body TEXT,
      user_id UUID NOT NULL,
      published BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT now()
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

  return { userId1, userId2 };
}
