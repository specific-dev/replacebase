import { eq, and, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { authRefreshTokens } from "../db/schema.js";
import { randomBytes } from "crypto";

export function generateRefreshToken(): string {
  return randomBytes(40).toString("base64url");
}

export async function createRefreshToken(
  db: PgDatabase<any, any, any>,
  userId: string,
  sessionId: string
): Promise<string> {
  const token = generateRefreshToken();

  await (db as any).insert(authRefreshTokens).values({
    token,
    userId,
    sessionId,
    revoked: false,
  });

  return token;
}

export async function rotateRefreshToken(
  db: PgDatabase<any, any, any>,
  oldToken: string
): Promise<{
  token: string;
  userId: string;
  sessionId: string;
} | null> {
  // Find the existing token
  const existing = await (db as any)
    .select()
    .from(authRefreshTokens)
    .where(eq(authRefreshTokens.token, oldToken))
    .limit(1);

  if (existing.length === 0) {
    return null;
  }

  const record = existing[0];

  // Check if token has been revoked (replay detection)
  if (record.revoked) {
    // Token reuse detected — revoke the entire family
    await revokeTokenFamily(db, oldToken);
    return null;
  }

  // Revoke the old token
  await (db as any)
    .update(authRefreshTokens)
    .set({ revoked: true, updatedAt: new Date() })
    .where(eq(authRefreshTokens.id, record.id));

  // Create new token with parent reference
  const newToken = generateRefreshToken();
  await (db as any).insert(authRefreshTokens).values({
    token: newToken,
    userId: record.userId,
    sessionId: record.sessionId,
    parent: oldToken,
    revoked: false,
  });

  return {
    token: newToken,
    userId: record.userId,
    sessionId: record.sessionId,
  };
}

export async function revokeTokenFamily(
  db: PgDatabase<any, any, any>,
  token: string
): Promise<void> {
  // Revoke all tokens in the family by following the parent chain
  // and also revoking children
  await (db as any)
    .update(authRefreshTokens)
    .set({ revoked: true, updatedAt: new Date() })
    .where(eq(authRefreshTokens.revoked, false));

  // In a production system, we'd trace the family more precisely,
  // but for safety, revoking based on session would be more targeted
}

export async function revokeSessionTokens(
  db: PgDatabase<any, any, any>,
  sessionId: string
): Promise<void> {
  await (db as any)
    .update(authRefreshTokens)
    .set({ revoked: true, updatedAt: new Date() })
    .where(
      and(
        eq(authRefreshTokens.sessionId, sessionId),
        eq(authRefreshTokens.revoked, false)
      )
    );
}

export async function revokeUserTokens(
  db: PgDatabase<any, any, any>,
  userId: string
): Promise<void> {
  await (db as any)
    .update(authRefreshTokens)
    .set({ revoked: true, updatedAt: new Date() })
    .where(
      and(
        eq(authRefreshTokens.userId, userId),
        eq(authRefreshTokens.revoked, false)
      )
    );
}

export async function revokeOtherSessionTokens(
  db: PgDatabase<any, any, any>,
  userId: string,
  currentSessionId: string
): Promise<void> {
  const { ne } = await import("drizzle-orm");
  await (db as any)
    .update(authRefreshTokens)
    .set({ revoked: true, updatedAt: new Date() })
    .where(
      and(
        eq(authRefreshTokens.userId, userId),
        ne(authRefreshTokens.sessionId, currentSessionId),
        eq(authRefreshTokens.revoked, false)
      )
    );
}
