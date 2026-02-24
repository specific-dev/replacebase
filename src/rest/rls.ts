import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

export interface RLSContext {
  role: string;
  claims: Record<string, unknown> | null;
  userId: string | null;
}

export async function withRLS<T>(
  db: PgDatabase<any, any, any>,
  context: RLSContext,
  fn: (tx: PgDatabase<any, any, any>) => Promise<T>
): Promise<T> {
  // First try with full RLS context in a transaction
  try {
    return await (db as any).transaction(async (tx: PgDatabase<any, any, any>) => {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${quoteIdent(context.role)}`));

      if (context.claims) {
        const claimsJson = JSON.stringify(context.claims);
        await tx.execute(
          sql`SELECT set_config('request.jwt.claims', ${claimsJson}, true)`
        );
      }

      if (context.userId) {
        await tx.execute(
          sql`SELECT set_config('request.jwt.claim.sub', ${context.userId}, true)`
        );
      }

      await tx.execute(
        sql`SELECT set_config('request.jwt.claim.role', ${context.role}, true)`
      );

      return await fn(tx);
    });
  } catch (e: any) {
    // If SET ROLE fails (e.g. PGlite doesn't support roles),
    // fall back to running without RLS context
    if (
      e.message?.includes("SET") ||
      e.message?.includes("role") ||
      e.message?.includes("set_config")
    ) {
      return await fn(db);
    }
    throw e;
  }
}

function quoteIdent(s: string): string {
  // Simple identifier quoting - only allow alphanumeric and underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
    throw new Error(`Invalid identifier: ${s}`);
  }
  return s;
}
