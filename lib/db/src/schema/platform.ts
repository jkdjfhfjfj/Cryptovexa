import { pgTable, text, timestamp, boolean, integer, numeric, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

const id = () => text("id").primaryKey();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const data = () => jsonb("data").$type<Record<string, any>>().notNull().default({});
const money = (name: string) => numeric(name, { precision: 38, scale: 18 }).notNull().default("0");

export const users = pgTable("users", {
  id: id(), email: text("email").notNull().unique(), username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(), role: text("role").notNull().default("user"),
  status: text("status").notNull().default("active"), language: text("language").notNull().default("en"),
  referralCode: text("referral_code").notNull().unique(), referredBy: text("referred_by"),
  emailVerified: boolean("email_verified").notNull().default(false),
  twofaSecret: text("twofa_secret"), twofaEnabled: boolean("twofa_enabled").notNull().default(false),
  kycStatus: text("kyc_status").notNull().default("not_requested"),
  withdrawalsBlocked: boolean("withdrawals_blocked").notNull().default(false), data: data(), createdAt: created(),
});
export const loginSessions = pgTable("login_sessions", {
  id: id(), userId: text("user_id").notNull().references(() => users.id), tokenHash: text("token_hash").notNull().unique(),
  scope: text("scope").notNull(), ip: text("ip"), device: text("device"), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked: boolean("revoked").notNull().default(false), createdAt: created(),
});
export const wallets = pgTable("wallets", {
  id: id(), userId: text("user_id").notNull().references(() => users.id), currency: text("currency").notNull(),
  balance: money("balance"), locked: money("locked"),
}, (t) => [uniqueIndex("wallet_owner_currency").on(t.userId, t.currency)]);
export const ledger = pgTable("ledger", {
  id: id(), userId: text("user_id").notNull().references(() => users.id), currency: text("currency").notNull(),
  amount: money("amount"), type: text("type").notNull(), refId: text("ref_id"), idempotencyKey: text("idempotency_key").notNull().unique(),
  balanceAfter: money("balance_after"), createdAt: created(),
});
export const assets = pgTable("assets", {
  id: id(), type: text("type").notNull(), title: text("title").notNull(), description: text("description").notNull(),
  location: text("location").notNull(), category: text("category").notNull(), images: jsonb("images").$type<string[]>().notNull().default([]),
  specs: jsonb("specs").notNull().default({}), status: text("status").notNull().default("active"),
  totalUnits: integer("total_units").notNull().default(1), availableUnits: integer("available_units").notNull().default(1),
  currency: text("currency").notNull().default("USDT"), minuteRate: money("minute_rate"), hourRate: money("hour_rate"), dayRate: money("day_rate"),
  minDuration: integer("min_duration").notNull().default(1), maxDuration: integer("max_duration").notNull().default(43200),
  data: data(), createdAt: created(),
});
export const rentals = pgTable("rentals", {
  id: id(), userId: text("user_id").notNull().references(() => users.id), assetId: text("asset_id").notNull().references(() => assets.id),
  billingMode: text("billing_mode").notNull(), rateSnapshot: money("rate_snapshot"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull().defaultNow(), createdAt: created(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(), billedUntil: timestamp("billed_until", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("active"), totalCost: money("total_cost"), autoRenew: boolean("auto_renew").notNull().default(false),
  units: integer("units").notNull().default(1), data: data(),
});
export const deposits = pgTable("deposits", {
  id: id(), userId: text("user_id").notNull().references(() => users.id), currency: text("currency").notNull(), network: text("network").notNull(),
  addressUsed: text("address_used").notNull(), amountClaimed: money("amount_claimed"), amountCredited: money("amount_credited"),
  txid: text("txid").unique(), proofImage: text("proof_image"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull().defaultNow(), status: text("status").notNull().default("pending_review"),
  reviewedBy: text("reviewed_by"), reviewNote: text("review_note"), data: data(), createdAt: created(),
});
export const withdrawals = pgTable("withdrawals", {
  id: id(), userId: text("user_id").notNull().references(() => users.id), currency: text("currency").notNull(), network: text("network").notNull(),
  address: text("address").notNull(), memo: text("memo"), amount: money("amount"), fee: money("fee"),
  status: text("status").notNull().default("pending_confirm"), txid: text("txid"), binanceId: text("binance_id"),
  failReason: text("fail_reason"), reviewedBy: text("reviewed_by"), data: data(), createdAt: created(),
});
export const settings = pgTable("settings", { key: text("key").primaryKey(), value: jsonb("value").notNull(), isSecret: boolean("is_secret").notNull().default(false) });
export const records = pgTable("platform_records", {
  id: id(), kind: text("kind").notNull(), userId: text("user_id"), data: data(), createdAt: created(),
});
export const auditLogs = pgTable("audit_logs", {
  id: id(), actorId: text("actor_id").notNull(), actorRole: text("actor_role").notNull(), action: text("action").notNull(),
  entityId: text("entity_id"), ip: text("ip"), meta: jsonb("meta").notNull().default({}), createdAt: created(),
});
export const emailLogs = pgTable("email_logs", {
  id: id(), to: text("to").notNull(), template: text("template").notNull(), status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0), error: text("error"), data: data(), createdAt: created(),
});
export const files = pgTable("private_files", {
  id: id(), userId: text("user_id").notNull(), objectPath: text("object_path").notNull().unique(), name: text("name").notNull(),
  contentType: text("content_type").notNull(), size: integer("size").notNull(), createdAt: created(),
});
export const tokens = pgTable("security_tokens", {
  id: id(), userId: text("user_id").notNull(), kind: text("kind").notNull(), hash: text("hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), used: boolean("used").notNull().default(false), data: data(),
});
export const insertUserSchema = createInsertSchema(users);
export const insertAssetSchema = createInsertSchema(assets);
export type User = typeof users.$inferSelect;
