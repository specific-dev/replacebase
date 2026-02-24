import { describe, it, expect, beforeAll } from "vitest";
import { createTestEnv, restRequest } from "../helpers.js";

describe("Auth Signup", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("signs up a new user", async () => {
    const res = await fetch("http://localhost:0/auth/v1/signup", {
      method: "POST",
    }).catch(() => null);

    // Use direct fetch on replacebase
    const request = new Request("http://localhost/auth/v1/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
      body: JSON.stringify({
        email: "test@example.com",
        password: "password123",
        data: { name: "Test User" },
      }),
    });

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.access_token).toBeDefined();
    expect(data.refresh_token).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe("test@example.com");
    expect(data.user.user_metadata.name).toBe("Test User");
    expect(data.user.identities).toHaveLength(1);
    expect(data.user.identities[0].provider).toBe("email");
  });

  it("rejects duplicate email", async () => {
    // First signup
    const request1 = new Request("http://localhost/auth/v1/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
      body: JSON.stringify({
        email: "dupe@example.com",
        password: "password123",
      }),
    });
    await env.replacebase.fetch(request1);

    // Second signup with same email
    const request2 = new Request("http://localhost/auth/v1/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
      body: JSON.stringify({
        email: "dupe@example.com",
        password: "password456",
      }),
    });

    const response = await env.replacebase.fetch(request2);
    expect(response.status).toBe(400);
  });

  it("rejects signup without password", async () => {
    const request = new Request("http://localhost/auth/v1/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
      body: JSON.stringify({ email: "nopass@example.com" }),
    });

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(400);
  });
});
