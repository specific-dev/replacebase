import {
  pgTable,
  pgSchema,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  bigint,
  integer,
  inet,
} from "drizzle-orm/pg-core";

export const authSchema = pgSchema("auth");

export const authUsers = authSchema.table("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  instanceId: uuid("instance_id"),
  aud: text("aud").default("authenticated"),
  role: text("role").default("authenticated"),
  email: text("email").unique(),
  encryptedPassword: text("encrypted_password"),
  emailConfirmedAt: timestamp("email_confirmed_at", { withTimezone: true }),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  confirmationToken: text("confirmation_token"),
  confirmationSentAt: timestamp("confirmation_sent_at", { withTimezone: true }),
  recoveryToken: text("recovery_token"),
  recoverySentAt: timestamp("recovery_sent_at", { withTimezone: true }),
  emailChangeTokenNew: text("email_change_token_new"),
  emailChange: text("email_change"),
  emailChangeSentAt: timestamp("email_change_sent_at", { withTimezone: true }),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
  rawAppMetaData: jsonb("raw_app_meta_data"),
  rawUserMetaData: jsonb("raw_user_meta_data"),
  isSuperAdmin: boolean("is_super_admin"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  phone: text("phone"),
  phoneConfirmedAt: timestamp("phone_confirmed_at", { withTimezone: true }),
  phoneChange: text("phone_change"),
  phoneChangeToken: text("phone_change_token"),
  phoneChangeSentAt: timestamp("phone_change_sent_at", { withTimezone: true }),
  emailChangeTokenCurrent: text("email_change_token_current"),
  emailChangeConfirmStatus: integer("email_change_confirm_status").default(0),
  bannedUntil: timestamp("banned_until", { withTimezone: true }),
  reauthenticationToken: text("reauthentication_token"),
  reauthenticationSentAt: timestamp("reauthentication_sent_at", {
    withTimezone: true,
  }),
  isSsoUser: boolean("is_sso_user").default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  isAnonymous: boolean("is_anonymous").default(false),
  // Better Auth additions (nullable, additive)
  name: text("name"),
  emailVerified: boolean("email_verified"),
  image: text("image"),
});

export const authRefreshTokens = authSchema.table("refresh_tokens", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  instanceId: uuid("instance_id"),
  token: text("token").unique(),
  userId: text("user_id"),
  revoked: boolean("revoked").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  parent: text("parent"),
  sessionId: uuid("session_id"),
});

export const authIdentities = authSchema.table("identities", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  identityData: jsonb("identity_data"),
  provider: text("provider").notNull(),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const authSessions = authSchema.table("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  factorId: uuid("factor_id"),
  aal: text("aal"),
  notAfter: timestamp("not_after", { withTimezone: true }),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  userAgent: text("user_agent"),
  ip: inet("ip"),
  tag: text("tag"),
});
