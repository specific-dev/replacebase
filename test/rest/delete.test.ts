import { describe, it, expect, beforeAll } from "vitest";
import { createTestEnv, restRequest } from "../helpers.js";

describe("REST Delete", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("deletes rows matching filter", async () => {
    // First verify the row exists
    let res = await restRequest(
      env.replacebase,
      "/posts?title=eq.Second Post",
      { apiKey: env.anonKey }
    );
    let data = await res.json();
    expect(data).toHaveLength(1);

    // Delete with return=representation (Second Post has no comments)
    res = await restRequest(
      env.replacebase,
      "/posts?title=eq.Second Post",
      {
        method: "DELETE",
        apiKey: env.anonKey,
        headers: { Prefer: "return=representation" },
      }
    );

    expect(res.status).toBe(200);
    data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Second Post");

    // Verify it's gone
    res = await restRequest(
      env.replacebase,
      "/posts?title=eq.Second Post",
      { apiKey: env.anonKey }
    );
    data = await res.json();
    expect(data).toHaveLength(0);
  });

  it("returns 204 for minimal delete", async () => {
    // Delete a profile (no FK references to profiles)
    const res = await restRequest(
      env.replacebase,
      `/profiles?id=eq.${env.userId2}`,
      {
        method: "DELETE",
        apiKey: env.anonKey,
      }
    );

    expect(res.status).toBe(204);
  });
});
