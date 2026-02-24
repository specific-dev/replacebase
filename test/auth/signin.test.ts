import { describe, it, expect, beforeAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("Auth Sign In", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;

  beforeAll(async () => {
    env = await createTestEnv();

    // Create a user to sign in with
    const request = new Request("http://localhost/auth/v1/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
      body: JSON.stringify({
        email: "signin@example.com",
        password: "password123",
      }),
    });
    await env.replacebase.fetch(request);
  });

  it("signs in with correct credentials", async () => {
    const request = new Request(
      "http://localhost/auth/v1/token?grant_type=password",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.anonKey,
          Authorization: `Bearer ${env.anonKey}`,
        },
        body: JSON.stringify({
          email: "signin@example.com",
          password: "password123",
        }),
      }
    );

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.access_token).toBeDefined();
    expect(data.refresh_token).toBeDefined();
    expect(data.user.email).toBe("signin@example.com");
  });

  it("rejects incorrect password", async () => {
    const request = new Request(
      "http://localhost/auth/v1/token?grant_type=password",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.anonKey,
          Authorization: `Bearer ${env.anonKey}`,
        },
        body: JSON.stringify({
          email: "signin@example.com",
          password: "wrongpassword",
        }),
      }
    );

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("invalid_grant");
  });

  it("rejects non-existent user", async () => {
    const request = new Request(
      "http://localhost/auth/v1/token?grant_type=password",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.anonKey,
          Authorization: `Bearer ${env.anonKey}`,
        },
        body: JSON.stringify({
          email: "noexist@example.com",
          password: "password123",
        }),
      }
    );

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(400);
  });
});
