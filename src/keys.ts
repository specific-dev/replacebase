import { jwtVerify, createRemoteJWKSet, type JWTVerifyResult } from "jose";

export interface JwtKeys {
  signingKey: Uint8Array;
  algorithm: "HS256";
  verify(token: string): Promise<JWTVerifyResult>;
}

export function resolveKeys(config: {
  jwtSecret: string;
  jwksUrl?: string;
}): JwtKeys {
  const signingKey = new TextEncoder().encode(config.jwtSecret);

  const jwksSet = config.jwksUrl
    ? createRemoteJWKSet(new URL(config.jwksUrl))
    : null;

  return {
    signingKey,
    algorithm: "HS256",
    async verify(token: string): Promise<JWTVerifyResult> {
      try {
        return await jwtVerify(token, signingKey);
      } catch (hs256Error) {
        if (jwksSet) {
          try {
            return await jwtVerify(token, jwksSet);
          } catch {
            // Both failed — throw the original HS256 error for tokens we signed,
            // or the JWKS error doesn't matter. Throw HS256 error as the default.
            throw hs256Error;
          }
        }
        throw hs256Error;
      }
    },
  };
}
