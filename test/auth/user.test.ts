import { describe, it, expect, beforeAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("Auth User", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;
  let accessToken: string;

  beforeAll(async () => {
    env = await createTestEnv();

    // Sign up and get access token
    const signupReq = new Request("http://localhost/auth/v1/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
      body: JSON.stringify({
        email: "user@example.com",
        password: "password123",
        data: { name: "Test User" },
      }),
    });
    const signupRes = await env.replacebase.fetch(signupReq);
    const data = await signupRes.json();
    accessToken = data.access_token;
  });

  it("gets current user", async () => {
    const request = new Request("http://localhost/auth/v1/user", {
      method: "GET",
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.email).toBe("user@example.com");
    expect(data.user_metadata.name).toBe("Test User");
    expect(data.identities).toHaveLength(1);
  });

  it("updates user metadata", async () => {
    const request = new Request("http://localhost/auth/v1/user", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        data: { name: "Updated User", bio: "Hello" },
      }),
    });

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.user_metadata.name).toBe("Updated User");
    expect(data.user_metadata.bio).toBe("Hello");
  });

  it("rejects unauthenticated request", async () => {
    const request = new Request("http://localhost/auth/v1/user", {
      method: "GET",
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
    });

    const response = await env.replacebase.fetch(request);
    // Should fail because anonKey doesn't have a sub claim
    expect(response.status).toBe(401);
  });
});
