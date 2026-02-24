import { describe, it, expect, beforeAll } from "vitest";
import { createTestEnv, restRequest } from "../helpers.js";

describe("REST Insert", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("inserts a row", async () => {
    const res = await restRequest(env.replacebase, "/posts", {
      method: "POST",
      apiKey: env.anonKey,
      body: {
        title: "New Post",
        body: "New body",
        user_id: env.userId1,
      },
      headers: { Prefer: "return=representation" },
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("New Post");
    expect(data[0].id).toBeDefined();
  });

  it("inserts multiple rows", async () => {
    const res = await restRequest(env.replacebase, "/posts", {
      method: "POST",
      apiKey: env.anonKey,
      body: [
        { title: "Batch 1", body: "b1", user_id: env.userId1 },
        { title: "Batch 2", body: "b2", user_id: env.userId2 },
      ],
      headers: { Prefer: "return=representation" },
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveLength(2);
  });

  it("returns 201 with no body for minimal prefer", async () => {
    const res = await restRequest(env.replacebase, "/posts", {
      method: "POST",
      apiKey: env.anonKey,
      body: {
        title: "Minimal Post",
        body: "minimal",
        user_id: env.userId1,
      },
    });

    expect(res.status).toBe(201);
  });
});
