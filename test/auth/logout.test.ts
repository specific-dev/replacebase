import { describe, it, expect, beforeAll } from "vitest";
import { createTestEnv } from "../helpers.js";

describe("Auth Logout", () => {
  let env: Awaited<ReturnType<typeof createTestEnv>>;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    env = await createTestEnv();

    // Sign up
    const signupReq = new Request("http://localhost/auth/v1/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
      },
      body: JSON.stringify({
        email: "logout@example.com",
        password: "password123",
      }),
    });
    const res = await env.replacebase.fetch(signupReq);
    const data = await res.json();
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
  });

  it("logs out successfully", async () => {
    const request = new Request("http://localhost/auth/v1/logout", {
      method: "POST",
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const response = await env.replacebase.fetch(request);
    expect(response.status).toBe(204);
  });

  it("refresh token is revoked after logout", async () => {
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
});
