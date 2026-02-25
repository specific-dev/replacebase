import { describe, it, expect, afterAll } from "vitest";
import { resolveKeys } from "../src/keys";
import { SignJWT, generateKeyPair, exportJWK } from "jose";
import { createServer, type Server } from "http";

const TEST_SECRET = "test-secret-for-replacebase-testing";

describe("resolveKeys", () => {
  it("returns signingKey and HS256 algorithm", () => {
    const keys = resolveKeys({ jwtSecret: TEST_SECRET });
    expect(keys.algorithm).toBe("HS256");
    expect(keys.signingKey).toBeInstanceOf(Uint8Array);
  });

  it("verifies HS256 tokens", async () => {
    const keys = resolveKeys({ jwtSecret: TEST_SECRET });

    const token = await new SignJWT({ sub: "user-1", role: "authenticated" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keys.signingKey);

    const result = await keys.verify(token);
    expect(result.payload.sub).toBe("user-1");
    expect(result.payload.role).toBe("authenticated");
  });

  it("rejects tokens signed with a different secret", async () => {
    const keys = resolveKeys({ jwtSecret: TEST_SECRET });
    const wrongSecret = new TextEncoder().encode("wrong-secret");

    const token = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(wrongSecret);

    await expect(keys.verify(token)).rejects.toThrow();
  });

  it("round-trips: sign with signingKey, verify with keys.verify", async () => {
    const keys = resolveKeys({ jwtSecret: TEST_SECRET });

    const token = await new SignJWT({
      sub: "abc-123",
      role: "authenticated",
      aal: "aal1",
      session_id: "sess-1",
    })
      .setProtectedHeader({ alg: keys.algorithm, typ: "JWT" })
      .setSubject("abc-123")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keys.signingKey);

    const result = await keys.verify(token);
    expect(result.payload.sub).toBe("abc-123");
    expect(result.payload.role).toBe("authenticated");
    expect(result.payload.session_id).toBe("sess-1");
  });
});

describe("JWKS fallback verification", () => {
  let server: Server;
  let jwksUrl: string;
  let esPrivateKey: CryptoKey;

  // Spin up a local JWKS endpoint serving an ES256 public key
  afterAll(() => server?.close());

  async function setupJwksServer() {
    if (server) return;

    const { privateKey, publicKey } = await generateKeyPair("ES256");
    esPrivateKey = privateKey;

    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "test-kid";
    publicJwk.alg = "ES256";
    publicJwk.use = "sig";

    const jwks = { keys: [publicJwk] };

    server = createServer((req, res) => {
      if (req.url === "/.well-known/jwks.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(jwks));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    jwksUrl = `http://localhost:${port}`;
  }

  it("falls back to JWKS for ES256 tokens", async () => {
    await setupJwksServer();

    const keys = resolveKeys({ jwtSecret: TEST_SECRET, jwksUrl });

    // Sign a token with the ES256 private key (simulating Supabase)
    const token = await new SignJWT({ sub: "supabase-user", role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "test-kid" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(esPrivateKey);

    // HS256 will fail, should fall back to JWKS
    const result = await keys.verify(token);
    expect(result.payload.sub).toBe("supabase-user");
    expect(result.payload.role).toBe("authenticated");
  });

  it("still verifies HS256 tokens when jwksUrl is configured", async () => {
    await setupJwksServer();

    const keys = resolveKeys({ jwtSecret: TEST_SECRET, jwksUrl });

    const token = await new SignJWT({ sub: "local-user", role: "authenticated" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keys.signingKey);

    // Should succeed on the first try (HS256), never hitting JWKS
    const result = await keys.verify(token);
    expect(result.payload.sub).toBe("local-user");
  });

  it("rejects ES256 tokens when no jwksUrl is configured", async () => {
    await setupJwksServer();

    const keys = resolveKeys({ jwtSecret: TEST_SECRET }); // no jwksUrl

    const token = await new SignJWT({ sub: "supabase-user" })
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "test-kid" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(esPrivateKey);

    // No JWKS fallback, should reject
    await expect(keys.verify(token)).rejects.toThrow();
  });

  it("rejects tokens that fail both HS256 and JWKS", async () => {
    await setupJwksServer();

    const keys = resolveKeys({ jwtSecret: TEST_SECRET, jwksUrl });

    // Sign with a different ES256 key (not in the JWKS)
    const { privateKey: otherKey } = await generateKeyPair("ES256");
    const token = await new SignJWT({ sub: "unknown" })
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "unknown-kid" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(otherKey);

    // HS256 fails (wrong alg), JWKS fails (unknown key) — should throw
    await expect(keys.verify(token)).rejects.toThrow();
  });
});
