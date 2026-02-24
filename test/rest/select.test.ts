import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestEnv, restRequest } from "../helpers.js";

describe("REST Select", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("selects all rows from a table", async () => {
    const res = await restRequest(env.replacebase, "/posts", {
      apiKey: env.anonKey,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(3);
  });

  it("selects specific columns", async () => {
    const res = await restRequest(env.replacebase, "/posts?select=id,title", {
      apiKey: env.anonKey,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(3);
    expect(Object.keys(data[0])).toEqual(["id", "title"]);
  });

  it("filters with eq", async () => {
    const res = await restRequest(env.replacebase, "/posts?title=eq.First Post", {
      apiKey: env.anonKey,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("First Post");
  });

  it("filters with neq", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?title=neq.First Post",
      { apiKey: env.anonKey }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  it("filters with in", async () => {
    const res = await restRequest(
      env.replacebase,
      `/posts?user_id=in.(${env.userId1})`,
      { apiKey: env.anonKey }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  it("filters with is.null", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?body=is.null",
      { apiKey: env.anonKey }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(0);
  });

  it("orders results", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?select=title&order=title.asc",
      { apiKey: env.anonKey }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data[0].title).toBe("First Post");
    expect(data[2].title).toBe("Third Post");
  });

  it("orders descending", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?select=title&order=title.desc",
      { apiKey: env.anonKey }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data[0].title).toBe("Third Post");
    expect(data[2].title).toBe("First Post");
  });

  it("applies limit", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?limit=2&order=title.asc",
      { apiKey: env.anonKey }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  it("applies offset", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?limit=1&offset=1&order=title.asc",
      { apiKey: env.anonKey }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Second Post");
  });

  it("returns exact count with Prefer header", async () => {
    const res = await restRequest(env.replacebase, "/posts?limit=2", {
      apiKey: env.anonKey,
      headers: { Prefer: "count=exact" },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(res.headers.get("Content-Range")).toContain("/3");
  });

  it("returns single object with Accept header", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?title=eq.First Post",
      {
        apiKey: env.anonKey,
        headers: { Accept: "application/vnd.pgrst.object+json" },
      }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("First Post");
    expect(Array.isArray(data)).toBe(false);
  });

  it("returns 406 for single object with multiple rows", async () => {
    const res = await restRequest(env.replacebase, "/posts", {
      apiKey: env.anonKey,
      headers: { Accept: "application/vnd.pgrst.object+json" },
    });

    expect(res.status).toBe(406);
  });

  it("returns 404 for non-existent table", async () => {
    const res = await restRequest(env.replacebase, "/nonexistent", {
      apiKey: env.anonKey,
    });

    expect(res.status).toBe(404);
  });

  it("handles boolean filter", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?published=eq.true",
      { apiKey: env.anonKey }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data.every((p: any) => p.published === true)).toBe(true);
  });

  it("handles or filter", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?or=(title.eq.First Post,title.eq.Third Post)",
      { apiKey: env.anonKey }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
  });
});
