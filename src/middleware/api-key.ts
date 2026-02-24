import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";

export function apiKeyMiddleware(jwtSecret: string) {
  const secret = new TextEncoder().encode(jwtSecret);

  return createMiddleware(async (c, next) => {
    const apiKey = c.req.header("apikey");

    if (!apiKey) {
      return c.json({ message: "Missing apikey header" }, 401);
    }

    // Verify apikey JWT
    let apiKeyPayload: any;
    try {
      const result = await jwtVerify(apiKey, secret);
      apiKeyPayload = result.payload;
    } catch {
      return c.json({ message: "Invalid API key" }, 401);
    }

    let role = apiKeyPayload.role || "anon";
    let claims: Record<string, unknown> | null = null;
    let userId: string | null = null;

    // Check Authorization header for user session token
    const authHeader = c.req.header("Authorization");
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "");

      // Only verify if it's different from the apikey (user token)
      if (token !== apiKey) {
        try {
          const result = await jwtVerify(token, secret);
          const payload = result.payload;

          role = (payload.role as string) || "authenticated";
          userId = (payload.sub as string) || null;
          claims = payload as Record<string, unknown>;
        } catch {
          return c.json({ message: "Invalid authorization token" }, 401);
        }
      }
    }

    // Set context
    c.set("role", role);
    c.set("claims", claims);
    c.set("userId", userId);

    await next();
  });
}
