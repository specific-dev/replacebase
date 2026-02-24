/**
 * Format a DB user row into GoTrue-compatible response shape.
 */
export function formatUserResponse(user: any, identities?: any[]): any {
  return {
    id: user.id,
    aud: user.aud || "authenticated",
    role: user.role || "authenticated",
    email: user.email,
    phone: user.phone || "",
    email_confirmed_at: user.emailConfirmedAt?.toISOString() || null,
    phone_confirmed_at: user.phoneConfirmedAt?.toISOString() || null,
    confirmation_sent_at: user.confirmationSentAt?.toISOString() || null,
    recovery_sent_at: user.recoverySentAt?.toISOString() || null,
    last_sign_in_at: user.lastSignInAt?.toISOString() || null,
    app_metadata: user.rawAppMetaData || { provider: "email", providers: ["email"] },
    user_metadata: user.rawUserMetaData || {},
    identities: identities?.map(formatIdentity) || [],
    created_at: user.createdAt?.toISOString() || new Date().toISOString(),
    updated_at: user.updatedAt?.toISOString() || new Date().toISOString(),
    is_anonymous: user.isAnonymous || false,
  };
}

function formatIdentity(identity: any): any {
  return {
    identity_id: identity.id,
    id: identity.providerId,
    user_id: identity.userId,
    identity_data: identity.identityData || {},
    provider: identity.provider,
    last_sign_in_at: identity.lastSignInAt?.toISOString() || null,
    created_at: identity.createdAt?.toISOString() || null,
    updated_at: identity.updatedAt?.toISOString() || null,
  };
}

export function formatSessionResponse(
  user: any,
  accessToken: string,
  refreshToken: string,
  expiresIn: number = 3600,
  identities?: any[]
): any {
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: refreshToken,
    user: formatUserResponse(user, identities),
  };
}
