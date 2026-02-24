import { SignJWT, jwtVerify } from "jose";

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
  jwtSecret: string,
  payload: SupabaseJwtPayload,
  expiresInSeconds: number = 3600
): Promise<string> {
  const secret = new TextEncoder().encode(jwtSecret);

  return await new SignJWT({
    ...payload,
    iss: "replacebase",
    aud: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(secret);
}

export async function verifyAccessToken(
  jwtSecret: string,
  token: string
): Promise<SupabaseJwtPayload> {
  const secret = new TextEncoder().encode(jwtSecret);
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as SupabaseJwtPayload;
}
