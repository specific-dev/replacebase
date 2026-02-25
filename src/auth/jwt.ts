import { SignJWT } from "jose";
import type { JwtKeys } from "../keys";

export interface SupabaseJwtPayload {
  sub: string;
  role: string;
  aal: string;
  session_id: string;
  email?: string;
  phone?: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  is_anonymous: boolean;
  amr: Array<{ method: string; timestamp: number }>;
}

export async function createAccessToken(
  keys: JwtKeys,
  payload: SupabaseJwtPayload,
  expiresInSeconds: number = 3600
): Promise<string> {
  return await new SignJWT({
    ...payload,
    iss: "replacebase",
    aud: "authenticated",
  })
    .setProtectedHeader({ alg: keys.algorithm, typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(keys.signingKey);
}

export async function verifyAccessToken(
  keys: JwtKeys,
  token: string
): Promise<SupabaseJwtPayload> {
  const { payload } = await keys.verify(token);
  return payload as unknown as SupabaseJwtPayload;
}
