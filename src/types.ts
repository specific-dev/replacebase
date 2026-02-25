import type { Hono } from "hono";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export interface StorageConfig {
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean;
  };
  keyPrefix?: string;
}

export interface ReplacebaseConfig {
  db: PostgresJsDatabase<any>;
  schema: Record<string, unknown>;
  jwtSecret: string;
  storage?: StorageConfig;
}

export interface Replacebase {
  fetch: (request: Request) => Response | Promise<Response>;
  toNodeHandler: () => (req: any, res: any) => void;
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
