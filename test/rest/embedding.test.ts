import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("REST Resource Embedding", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  // One-to-many: posts have many comments (comments.post_id -> posts.id)
  it("embeds one-to-many (posts with comments)", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("id,title,comments(id,body)")
      .eq("title", "First Post");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].comments).toHaveLength(2);
    expect(data![0].comments[0]).toHaveProperty("body");
    expect(data![0].comments[0]).toHaveProperty("id");
  });

  // Many-to-one: comments belong to a post (comments.post_id -> posts.id)
  it("embeds many-to-one (comments with post)", async () => {
    const { data, error } = await env.supabase
      .from("comments")
      .select("id,body,posts(id,title)")
      .limit(1);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    // Many-to-one returns a single object, not an array
    expect(data![0].posts).toHaveProperty("title");
    expect(data![0].posts).toHaveProperty("id");
  });

  // Embedding with specific columns (not *)
  it("embeds with specific column selection", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title,comments(body)")
      .eq("title", "First Post");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].comments).toHaveLength(2);
    // Should only have 'body', not 'id', 'post_id', etc.
    const commentKeys = Object.keys(data![0].comments[0]);
    expect(commentKeys).toContain("body");
  });

  // Inner join: filter out parents with no children
  it("embeds with inner join (!inner)", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title,comments!inner(body)")
      .order("title");

    expect(error).toBeNull();
    // Second Post has no comments, should be filtered out
    expect(data!.length).toBeLessThan(3);
    for (const post of data!) {
      expect(post.comments.length).toBeGreaterThan(0);
    }
  });

  // Post with no comments returns empty array
  it("returns empty array for posts with no embedded children", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title,comments(body)")
      .eq("title", "Second Post");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].comments).toEqual([]);
  });

  // Error for non-existent embedded table
  it("returns error for non-existent embedded resource", async () => {
    const { error } = await env.supabase
      .from("posts")
      .select("title,nonexistent(id)");

    expect(error).not.toBeNull();
  });

  // Many-to-many: posts through post_categories to categories
  it("embeds many-to-many (posts with categories)", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title,categories(name)")
      .eq("title", "Third Post");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].categories).toHaveLength(2);
    const names = data![0].categories.map((c: any) => c.name).sort();
    expect(names).toEqual(["Life", "Tech"]);
  });

  it("embeds many-to-many with no matches", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .select("title,categories(name)")
      .eq("title", "Second Post");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].categories).toEqual([]);
  });

  // Nested embedding: posts -> comments -> (could add more)
  it("embeds nested resources (posts with comments)", async () => {
    // Test that nested embedding parsing + execution works
    const { data, error } = await env.supabase
      .from("posts")
      .select("title,comments(body,posts(title))")
      .eq("title", "First Post");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].comments).toHaveLength(2);
    // Each comment should have its parent post embedded
    for (const comment of data![0].comments) {
      expect(comment.posts).toHaveProperty("title");
    }
  });
});
