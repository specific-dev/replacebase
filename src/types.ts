import type { Hono } from "hono";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { ForeignKeyMeta } from "./rest/schema-registry";

export interface StorageConfig {
  s3: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean;
  };
  keyPrefix?: string;
}

export interface ReplacebaseConfig {
  databaseUrl: string;
  jwtSecret: string;
  jwksUrl?: string;
  storage?: StorageConfig;
  schemas?: string[];
}

/** Internal resolved config passed to createApp after introspection */
export interface ResolvedConfig {
  db: PgDatabase<any, any, any>;
  schema: Record<string, unknown>;
  foreignKeys: Map<string, ForeignKeyMeta[]>;
  jwtSecret: string;
  jwksUrl?: string;
  storage?: StorageConfig;
}

export interface Replacebase {
  fetch: (request: Request) => Response | Promise<Response>;
  toNodeHandler: () => (req: any, res: any) => void;
  /** Inject WebSocket handling into a Node.js HTTP server for Realtime support */
  injectWebSocket: (server: any) => void;
  app: Hono;
}

export interface JwtClaims {
  sub: string;
  role: string;
  aal?: string;
  session_id?: string;
  email?: string;
  phone?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  is_anonymous?: boolean;
  amr?: Array<{ method: string; timestamp: number }>;
  iss?: string;
  iat?: number;
  exp?: number;
}

export interface RequestContext {
  role: string;
  claims: JwtClaims | null;
  userId: string | null;
}
