import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { hash, compare } from "bcryptjs";
import { authUsers, authIdentities, authSessions } from "../db/schema";
import { createAccessToken, verifyAccessToken } from "./jwt";
import {
  createRefreshToken,
  rotateRefreshToken,
  revokeSessionTokens,
  revokeUserTokens,
  revokeOtherSessionTokens,
} from "./refresh-tokens";
import {
  formatUserResponse,
  formatSessionResponse,
} from "./user-response";
import type { JwtKeys } from "../keys";

function isServiceRole(c: any): boolean {
  return c.get?.("role") === "service_role";
}

export function createAuthRouter(
  db: PgDatabase<any, any, any>,
  keys: JwtKeys
): Hono {
  const app = new Hono();

  // POST /signup
  app.post("/signup", async (c) => {
    const body = await c.req.json();
    const { email, password, data: userData, phone } = body;

    // Handle anonymous sign-up (no email/password)
    if (!email && !password) {
      return await handleAnonymousSignup(c, db, keys, userData);
    }

    if (!email || !password) {
      return c.json({ error: "email and password are required" }, 400);
    }

    // Check if user already exists
    const existing = await (db as any)
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .limit(1);

    if (existing.length > 0) {
      return c.json(
        {
          error: "User already registered",
          error_description: "User already registered",
        },
        400
      );
    }

    // Hash password
    const encryptedPassword = await hash(password, 10);
    const now = new Date();

    // Create user
    const [user] = await (db as any)
      .insert(authUsers)
      .values({
        email,
        encryptedPassword,
        emailConfirmedAt: now, // Auto-confirm for now
        rawAppMetaData: { provider: "email", providers: ["email"] },
        rawUserMetaData: userData || {},
        role: "authenticated",
        aud: "authenticated",
        lastSignInAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create identity
    const [identity] = await (db as any)
      .insert(authIdentities)
      .values({
        userId: user.id,
        providerId: user.id,
        provider: "email",
        identityData: {
          sub: user.id,
          email: user.email,
          email_verified: true,
          provider: "email",
        },
        lastSignInAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create session
    const [session] = await (db as any)
      .insert(authSessions)
      .values({
        userId: user.id,
        aal: "aal1",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Generate tokens
    const accessToken = await createAccessToken(keys, {
      sub: user.id,
      role: "authenticated",
      aal: "aal1",
      session_id: session.id,
      email: user.email,
      app_metadata: user.rawAppMetaData || {},
      user_metadata: user.rawUserMetaData || {},
      is_anonymous: false,
      amr: [{ method: "password", timestamp: Math.floor(now.getTime() / 1000) }],
    });

    const refreshToken = await createRefreshToken(db, user.id, session.id);

    return c.json(
      formatSessionResponse(user, accessToken, refreshToken, 3600, [identity]),
      200
    );
  });

  // POST /token?grant_type=password|refresh_token
  app.post("/token", async (c) => {
    const url = new URL(c.req.url);
    const grantType = url.searchParams.get("grant_type");
    const body = await c.req.json();

    if (grantType === "password") {
      return await handlePasswordGrant(c, db, keys, body);
    } else if (grantType === "refresh_token") {
      return await handleRefreshGrant(c, db, keys, body);
    } else {
      return c.json({ error: "unsupported_grant_type" }, 400);
    }
  });

  // POST /recover - Password recovery
  app.post("/recover", async (c) => {
    const body = await c.req.json();
    const { email } = body;

    if (!email) {
      return c.json({ error: "email is required" }, 400);
    }

    // Always return success to prevent email enumeration
    // In a real implementation, this would send a recovery email
    const users = await (db as any)
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .limit(1);

    if (users.length > 0) {
      // Store recovery token (for future use when email sending is implemented)
      const { randomBytes } = await import("crypto");
      const recoveryToken = randomBytes(32).toString("hex");

      await (db as any)
        .update(authUsers)
        .set({
          recoveryToken,
          recoverySentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(authUsers.id, users[0].id));
    }

    return c.json({}, 200);
  });

  // GET /user
  app.get("/user", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    let payload;
    try {
      payload = await verifyAccessToken(keys, token);
    } catch {
      return c.json({ error: "invalid_token" }, 401);
    }

    if (!payload.sub) {
      return c.json({ error: "not_authenticated", error_description: "No user context in token" }, 401);
    }

    const users = await (db as any)
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, payload.sub))
      .limit(1);

    if (users.length === 0) {
      return c.json({ error: "user_not_found" }, 404);
    }

    const identities = await (db as any)
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, payload.sub));

    return c.json(formatUserResponse(users[0], identities));
  });

  // PUT /user
  app.put("/user", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    let payload;
    try {
      payload = await verifyAccessToken(keys, token);
    } catch {
      return c.json({ error: "invalid_token" }, 401);
    }

    if (!payload.sub) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    const body = await c.req.json();
    const updates: Record<string, any> = { updatedAt: new Date() };

    if (body.email) {
      updates.email = body.email;
    }
    if (body.password) {
      updates.encryptedPassword = await hash(body.password, 10);
    }
    if (body.data) {
      // Merge user metadata
      const current = await (db as any)
        .select()
        .from(authUsers)
        .where(eq(authUsers.id, payload.sub))
        .limit(1);

      if (current.length > 0) {
        updates.rawUserMetaData = {
          ...(current[0].rawUserMetaData || {}),
          ...body.data,
        };
      }
    }
    if (body.phone) {
      updates.phone = body.phone;
    }

    const [updated] = await (db as any)
      .update(authUsers)
      .set(updates)
      .where(eq(authUsers.id, payload.sub))
      .returning();

    const identities = await (db as any)
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, payload.sub));

    return c.json(formatUserResponse(updated, identities));
  });

  // POST /logout
  app.post("/logout", async (c) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    let payload;
    try {
      payload = await verifyAccessToken(keys, token);
    } catch {
      return c.json({ error: "invalid_token" }, 401);
    }

    // Parse scope from query param (default: "global" per GoTrue spec)
    const url = new URL(c.req.url);
    const scope = url.searchParams.get("scope") || "global";

    if (scope === "global") {
      await revokeUserTokens(db, payload.sub);
    } else if (scope === "local") {
      if (payload.session_id) {
        await revokeSessionTokens(db, payload.session_id);
      }
    } else if (scope === "others") {
      if (payload.session_id) {
        await revokeOtherSessionTokens(db, payload.sub, payload.session_id);
      }
    }

    return c.body(null, 204);
  });

  // GET /health
  app.get("/health", (c) => {
    return c.json({
      version: "replacebase",
      name: "GoTrue",
      description: "Replacebase Auth",
    });
  });

  // GET /settings
  app.get("/settings", (c) => {
    return c.json({
      external: {
        email: true,
        phone: false,
        apple: false,
        azure: false,
        bitbucket: false,
        discord: false,
        facebook: false,
        figma: false,
        github: false,
        gitlab: false,
        google: false,
        keycloak: false,
        linkedin: false,
        linkedin_oidc: false,
        notion: false,
        slack: false,
        slack_oidc: false,
        spotify: false,
        twitch: false,
        twitter: false,
        workos: false,
        zoom: false,
      },
      disable_signup: false,
      mailer_autoconfirm: true,
      phone_autoconfirm: false,
      sms_provider: "",
    });
  });

  // ---- Admin Endpoints ----

  // GET /admin/users
  app.get("/admin/users", async (c) => {
    if (!isServiceRole(c)) {
      return c.json({ error: "not_admin", error_description: "User not allowed" }, 401);
    }

    const url = new URL(c.req.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const perPage = parseInt(url.searchParams.get("per_page") || "50");
    const offset = (page - 1) * perPage;

    const users = await (db as any)
      .select()
      .from(authUsers)
      .limit(perPage)
      .offset(offset);

    // Get identities for all users
    const formattedUsers = [];
    for (const user of users) {
      const identities = await (db as any)
        .select()
        .from(authIdentities)
        .where(eq(authIdentities.userId, user.id));

      formattedUsers.push(formatUserResponse(user, identities));
    }

    return c.json({ users: formattedUsers, aud: "authenticated" });
  });

  // GET /admin/users/:id
  app.get("/admin/users/:id", async (c) => {
    if (!isServiceRole(c)) {
      return c.json({ error: "not_admin", error_description: "User not allowed" }, 401);
    }

    const userId = c.req.param("id");

    const users = await (db as any)
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .limit(1);

    if (users.length === 0) {
      return c.json({ error: "user_not_found" }, 404);
    }

    const identities = await (db as any)
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, userId));

    return c.json(formatUserResponse(users[0], identities));
  });

  // POST /admin/users
  app.post("/admin/users", async (c) => {
    if (!isServiceRole(c)) {
      return c.json({ error: "not_admin", error_description: "User not allowed" }, 401);
    }

    const body = await c.req.json();
    const { email, password, email_confirm, user_metadata, app_metadata, phone, ban_duration } = body;

    if (!email) {
      return c.json({ error: "email is required" }, 400);
    }

    const now = new Date();
    const values: Record<string, any> = {
      email,
      rawAppMetaData: app_metadata || { provider: "email", providers: ["email"] },
      rawUserMetaData: user_metadata || {},
      role: "authenticated",
      aud: "authenticated",
      createdAt: now,
      updatedAt: now,
    };

    if (password) {
      values.encryptedPassword = await hash(password, 10);
    }
    if (email_confirm) {
      values.emailConfirmedAt = now;
    }
    if (phone) {
      values.phone = phone;
    }
    if (ban_duration) {
      values.bannedUntil = parseBanDuration(ban_duration);
    }

    const [user] = await (db as any)
      .insert(authUsers)
      .values(values)
      .returning();

    // Create identity
    const [identity] = await (db as any)
      .insert(authIdentities)
      .values({
        userId: user.id,
        providerId: user.id,
        provider: "email",
        identityData: {
          sub: user.id,
          email: user.email,
          email_verified: !!email_confirm,
          provider: "email",
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return c.json(formatUserResponse(user, [identity]));
  });

  // PUT /admin/users/:id
  app.put("/admin/users/:id", async (c) => {
    if (!isServiceRole(c)) {
      return c.json({ error: "not_admin", error_description: "User not allowed" }, 401);
    }

    const userId = c.req.param("id");
    const body = await c.req.json();
    const updates: Record<string, any> = { updatedAt: new Date() };

    if (body.email) {
      updates.email = body.email;
    }
    if (body.password) {
      updates.encryptedPassword = await hash(body.password, 10);
    }
    if (body.user_metadata) {
      // Merge with existing
      const current = await (db as any)
        .select()
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .limit(1);

      if (current.length > 0) {
        updates.rawUserMetaData = {
          ...(current[0].rawUserMetaData || {}),
          ...body.user_metadata,
        };
      }
    }
    if (body.app_metadata) {
      const current = await (db as any)
        .select()
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .limit(1);

      if (current.length > 0) {
        updates.rawAppMetaData = {
          ...(current[0].rawAppMetaData || {}),
          ...body.app_metadata,
        };
      }
    }
    if (body.phone) {
      updates.phone = body.phone;
    }
    if (body.email_confirm === true) {
      updates.emailConfirmedAt = new Date();
    }
    if (body.ban_duration !== undefined) {
      updates.bannedUntil = parseBanDuration(body.ban_duration);
    }

    const result = await (db as any)
      .update(authUsers)
      .set(updates)
      .where(eq(authUsers.id, userId))
      .returning();

    if (result.length === 0) {
      return c.json({ error: "user_not_found" }, 404);
    }

    const identities = await (db as any)
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, userId));

    return c.json(formatUserResponse(result[0], identities));
  });

  // DELETE /admin/users/:id
  app.delete("/admin/users/:id", async (c) => {
    if (!isServiceRole(c)) {
      return c.json({ error: "not_admin", error_description: "User not allowed" }, 401);
    }

    const userId = c.req.param("id");

    // Delete user (cascades to identities and sessions)
    const result = await (db as any)
      .delete(authUsers)
      .where(eq(authUsers.id, userId))
      .returning();

    if (result.length === 0) {
      return c.json({ error: "user_not_found" }, 404);
    }

    return c.json({}, 200);
  });

  return app;
}

async function handleAnonymousSignup(
  c: any,
  db: PgDatabase<any, any, any>,
  keys: JwtKeys,
  userData?: Record<string, any>
) {
  const now = new Date();

  const [user] = await (db as any)
    .insert(authUsers)
    .values({
      rawAppMetaData: { provider: "anonymous", providers: ["anonymous"] },
      rawUserMetaData: userData || {},
      role: "authenticated",
      aud: "authenticated",
      isAnonymous: true,
      lastSignInAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Create session
  const [session] = await (db as any)
    .insert(authSessions)
    .values({
      userId: user.id,
      aal: "aal1",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const accessToken = await createAccessToken(keys, {
    sub: user.id,
    role: "authenticated",
    aal: "aal1",
    session_id: session.id,
    app_metadata: user.rawAppMetaData || {},
    user_metadata: user.rawUserMetaData || {},
    is_anonymous: true,
    amr: [{ method: "anonymous", timestamp: Math.floor(now.getTime() / 1000) }],
  });

  const refreshToken = await createRefreshToken(db, user.id, session.id);

  return c.json(
    formatSessionResponse(user, accessToken, refreshToken, 3600, []),
    200
  );
}

async function handlePasswordGrant(
  c: any,
  db: PgDatabase<any, any, any>,
  keys: JwtKeys,
  body: { email?: string; password?: string }
) {
  const { email, password } = body;

  if (!email || !password) {
    return c.json({ error: "invalid_grant", error_description: "Email and password are required" }, 400);
  }

  const users = await (db as any)
    .select()
    .from(authUsers)
    .where(eq(authUsers.email, email))
    .limit(1);

  if (users.length === 0) {
    return c.json(
      { error: "invalid_grant", error_description: "Invalid login credentials" },
      400
    );
  }

  const user = users[0];

  // Check if user is banned
  if (user.bannedUntil && new Date(user.bannedUntil) > new Date()) {
    return c.json(
      { error: "user_banned", error_description: "User is banned" },
      403
    );
  }

  if (!user.encryptedPassword) {
    return c.json(
      { error: "invalid_grant", error_description: "Invalid login credentials" },
      400
    );
  }

  const passwordValid = await compare(password, user.encryptedPassword);
  if (!passwordValid) {
    return c.json(
      { error: "invalid_grant", error_description: "Invalid login credentials" },
      400
    );
  }

  const now = new Date();

  // Update last sign in
  await (db as any)
    .update(authUsers)
    .set({ lastSignInAt: now, updatedAt: now })
    .where(eq(authUsers.id, user.id));

  // Create session
  const [session] = await (db as any)
    .insert(authSessions)
    .values({
      userId: user.id,
      aal: "aal1",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Generate tokens
  const accessToken = await createAccessToken(keys, {
    sub: user.id,
    role: "authenticated",
    aal: "aal1",
    session_id: session.id,
    email: user.email,
    app_metadata: user.rawAppMetaData || {},
    user_metadata: user.rawUserMetaData || {},
    is_anonymous: user.isAnonymous || false,
    amr: [{ method: "password", timestamp: Math.floor(now.getTime() / 1000) }],
  });

  const refreshToken = await createRefreshToken(db, user.id, session.id);

  const identities = await (db as any)
    .select()
    .from(authIdentities)
    .where(eq(authIdentities.userId, user.id));

  return c.json(
    formatSessionResponse(user, accessToken, refreshToken, 3600, identities)
  );
}

async function handleRefreshGrant(
  c: any,
  db: PgDatabase<any, any, any>,
  keys: JwtKeys,
  body: { refresh_token?: string }
) {
  const { refresh_token } = body;

  if (!refresh_token) {
    return c.json({ error: "invalid_grant", error_description: "Refresh token is required" }, 400);
  }

  const result = await rotateRefreshToken(db, refresh_token);
  if (!result) {
    return c.json(
      { error: "invalid_grant", error_description: "Invalid refresh token" },
      400
    );
  }

  const users = await (db as any)
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, result.userId))
    .limit(1);

  if (users.length === 0) {
    return c.json({ error: "invalid_grant", error_description: "User not found" }, 400);
  }

  const user = users[0];
  const now = new Date();

  const accessToken = await createAccessToken(keys, {
    sub: user.id,
    role: "authenticated",
    aal: "aal1",
    session_id: result.sessionId,
    email: user.email,
    app_metadata: user.rawAppMetaData || {},
    user_metadata: user.rawUserMetaData || {},
    is_anonymous: user.isAnonymous || false,
    amr: [{ method: "password", timestamp: Math.floor(now.getTime() / 1000) }],
  });

  const identities = await (db as any)
    .select()
    .from(authIdentities)
    .where(eq(authIdentities.userId, user.id));

  return c.json(
    formatSessionResponse(user, accessToken, result.token, 3600, identities)
  );
}

function parseBanDuration(duration: string): Date | null {
  if (!duration || duration === "none" || duration === "0s") {
    return null; // Unban
  }

  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    // Try parsing hours-only format like "876000h"
    const hoursMatch = duration.match(/^(\d+)h$/);
    if (hoursMatch) {
      const ms = parseInt(hoursMatch[1]) * 60 * 60 * 1000;
      return new Date(Date.now() + ms);
    }
    return null;
  }

  const value = parseInt(match[1]);
  const unit = match[2];
  let ms: number;

  switch (unit) {
    case "s":
      ms = value * 1000;
      break;
    case "m":
      ms = value * 60 * 1000;
      break;
    case "h":
      ms = value * 60 * 60 * 1000;
      break;
    case "d":
      ms = value * 24 * 60 * 60 * 1000;
      break;
    default:
      return null;
  }

  return new Date(Date.now() + ms);
}
