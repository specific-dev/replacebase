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
  return await (db as any).transaction(async (tx: PgDatabase<any, any, any>) => {
    // Set the role for this transaction
    await tx.execute(sql`SELECT set_config('role', ${context.role}, true)`);

    // Set JWT claims as JSON
    if (context.claims) {
      const claimsJson = JSON.stringify(context.claims);
      await tx.execute(
        sql`SELECT set_config('request.jwt.claims', ${claimsJson}, true)`
      );
    }

    // Set individual claim values for auth.uid() and similar functions
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
}
