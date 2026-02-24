import { describe, it, expect, beforeAll } from "vitest";
import { createTestEnv, restRequest } from "../helpers.js";

describe("REST Update", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("updates rows matching filter", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?title=eq.First Post",
      {
        method: "PATCH",
        apiKey: env.anonKey,
        body: { body: "Updated body" },
        headers: { Prefer: "return=representation" },
      }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].body).toBe("Updated body");
    expect(data[0].title).toBe("First Post");
  });

  it("returns 204 for minimal prefer", async () => {
    const res = await restRequest(
      env.replacebase,
      "/posts?title=eq.Second Post",
      {
        method: "PATCH",
        apiKey: env.anonKey,
        body: { published: true },
      }
    );

    expect(res.status).toBe(204);
  });
});
