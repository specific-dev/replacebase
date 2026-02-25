import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv } from "../helpers";

describe("REST Update", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(() => env.cleanup());

  it("updates rows matching filter and returns them", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .update({ body: "Updated body" })
      .eq("title", "First Post")
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].body).toBe("Updated body");
    expect(data![0].title).toBe("First Post");
  });

  it("updates without returning data", async () => {
    const { data, error } = await env.supabase
      .from("posts")
      .update({ published: true })
      .eq("title", "Second Post");

    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});
