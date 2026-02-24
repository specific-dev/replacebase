import { describe, it, expect, beforeAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("Auth Token Refresh", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;
  let refreshToken: string;

  beforeAll(async () => {
    env = await createTestEnv();

    // Sign up and get tokens
    const signupReq = new Request("http://localhost/auth/v1/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
      body: JSON.stringify({
        email: "refresh@example.com",
        password: "password123",
      }),
    });
    const signupRes = await env.replacebase.fetch(signupReq);
    const data = await signupRes.json();
    refreshToken = data.refresh_token;
  });

  it("refreshes token successfully", async () => {
    const request = new Request(
      "http://localhost/auth/v1/token?grant_type=refresh_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.anonKey,
          Authorization: `Bearer ${env.anonKey}`,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.access_token).toBeDefined();
    expect(data.refresh_token).toBeDefined();
    // New refresh token should be different
    expect(data.refresh_token).not.toBe(refreshToken);
    expect(data.user.email).toBe("refresh@example.com");
  });

  it("rejects reused (rotated) refresh token", async () => {
    // The old refreshToken was already used above, so reusing it should fail
    const request = new Request(
      "http://localhost/auth/v1/token?grant_type=refresh_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.anonKey,
          Authorization: `Bearer ${env.anonKey}`,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(400);
  });

  it("rejects invalid refresh token", async () => {
    const request = new Request(
      "http://localhost/auth/v1/token?grant_type=refresh_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.anonKey,
          Authorization: `Bearer ${env.anonKey}`,
        },
        body: JSON.stringify({ refresh_token: "invalid-token" }),
      }
    );

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(400);
  });
});
