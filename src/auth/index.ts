import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { hash, compare } from "bcryptjs";
import { authUsers, authIdentities, authSessions } from "../db/schema.js";
import { createAccessToken, verifyAccessToken } from "./jwt.js";
import {
  createRefreshToken,
  rotateRefreshToken,
  revokeSessionTokens,
  revokeUserTokens,
} from "./refresh-tokens.js";
import {
  formatUserResponse,
  formatSessionResponse,
} from "./user-response.js";

export function createAuthRouter(
  db: PgDatabase<any, any, any>,
  jwtSecret: string
): Hono {
  const app = new Hono();

  // POST /signup
  app.post("/signup", async (c) => {
    const body = await c.req.json();
    const { email, password, data: userData, phone } = body;

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
    const accessToken = await createAccessToken(jwtSecret, {
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
      return await handlePasswordGrant(c, db, jwtSecret, body);
    } else if (grantType === "refresh_token") {
      return await handleRefreshGrant(c, db, jwtSecret, body);
    } else {
      return c.json({ error: "unsupported_grant_type" }, 400);
    }
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
      payload = await verifyAccessToken(jwtSecret, token);
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
      payload = await verifyAccessToken(jwtSecret, token);
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
      payload = await verifyAccessToken(jwtSecret, token);
    } catch {
      return c.json({ error: "invalid_token" }, 401);
    }

    // Revoke all refresh tokens for the session
    if (payload.session_id) {
      await revokeSessionTokens(db, payload.session_id);
    } else {
      await revokeUserTokens(db, payload.sub);
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

  return app;
}

async function handlePasswordGrant(
  c: any,
  db: PgDatabase<any, any, any>,
  jwtSecret: string,
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
  const accessToken = await createAccessToken(jwtSecret, {
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
  jwtSecret: string,
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

  const accessToken = await createAccessToken(jwtSecret, {
    sub: user.id,
    role: "authenticated",
    aal: "aal1",
    session_id: result.sessionId,
    email: user.email,
    app_metadata: user.rawAppMetaData || {},
    user_metadata: user.rawUserMetaData || {},
    is_anonymous: false,
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
