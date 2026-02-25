import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  body: text("body"),
  userId: uuid("user_id").notNull(),
  published: boolean("published").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  searchVector: tsvector("search_vector"),
  tags: text("tags").array(),
});

export const comments = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  body: text("body").notNull(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id),
  userId: uuid("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
});

export const categories = pgTable("categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  description: text("description"),
});

export const postCategories = pgTable(
  "post_categories",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
  },
  (t) => [primaryKey({ columns: [t.postId, t.categoryId] })]
);

export const testSchema = {
  posts,
  comments,
  profiles,
  categories,
  postCategories,
};
