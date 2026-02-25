import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("REST Views", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  it("selects all rows from a view", async () => {
    const { data, error } = await env.supabase.from("post_details").select();

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    expect(data![0]).toHaveProperty("author_name");
  });

  it("selects specific columns from a view", async () => {
    const { data, error } = await env.supabase
      .from("post_details")
      .select("title,author_name");

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    expect(Object.keys(data![0])).toEqual(["title", "author_name"]);
  });

  it("filters on a view", async () => {
    const { data, error } = await env.supabase
      .from("post_details")
      .select()
      .eq("published", true);

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("orders results from a view", async () => {
    const { data, error } = await env.supabase
      .from("post_details")
      .select("title")
      .order("title", { ascending: true });

    expect(error).toBeNull();
    expect(data![0].title).toBe("First Post");
    expect(data![2].title).toBe("Third Post");
  });

  it("rejects insert into a view", async () => {
    const { error } = await env.supabase
      .from("post_details")
      .insert({ title: "Bad", body: "Should fail", user_id: env.userId1 });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("Cannot insert into a view");
  });

  it("rejects update on a view", async () => {
    const { error } = await env.supabase
      .from("post_details")
      .update({ title: "Updated" })
      .eq("published", true);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("Cannot update a view");
  });

  it("rejects delete on a view", async () => {
    const { error } = await env.supabase
      .from("post_details")
      .delete()
      .eq("published", false);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("Cannot delete from a view");
  });
});
