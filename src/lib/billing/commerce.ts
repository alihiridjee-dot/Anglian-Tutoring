/**
 * Types for the products catalogue and the money ledger, matching
 * supabase/migrations/20261108120000_commercial_ledger.sql column for column.
 *
 * The generated `src/integrations/supabase/types.ts` has these tables too
 * (added 9 Nov 2026, when the migration was applied), with the same columns.
 * These types are narrower: kinds and intervals are the CHECK lists rather
 * than plain strings, and my_entitlements().ends_at may be null (access for
 * good), which the generator can't see.
 *
 * The string lists below mirror the CHECK constraints; the migration's test
 * (scripts/test-commercial-ledger-db.ts) fails if the two ever drift apart.
 *
 * Conventions: money is integer pence (GBP), never a float of pounds;
 * timestamps are ISO strings as PostgREST returns them; bigint balances come
 * back as JSON numbers, safe far beyond any real balance.
 */
import type { Database } from "@/integrations/supabase/types";

type Enums = Database["public"]["Enums"];
export type Level = Enums["level"];
export type Subject = Enums["subject"];
export type Board = Enums["board"];

/** ISO-8601 timestamp, as PostgREST serialises `timestamptz`. */
export type Timestamp = string;
/** A uuid. */
export type Uuid = string;
/** Whole pence. Signed on ledger entries, positive everywhere else. */
export type Pence = number;

// --- Catalogue ---------------------------------------------------------------

export const BILLING_INTERVALS = ["week", "month", "quarter", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const CURRENCIES = ["GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** public.access_tiers — a higher rank includes everything a lower one does. */
export interface AccessTier {
  code: string;
  name: string;
  rank: number;
  description: string | null;
  created_at: Timestamp;
}

/** public.products — what can be bought. */
export interface Product {
  id: Uuid;
  slug: string;
  name: string;
  description: string | null;
  /** access_tiers.code */
  access_tier: string;
  active: boolean;
  sort_order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** public.product_modules — one level + subject (+ board) a product unlocks. */
export interface ProductModule {
  id: Uuid;
  product_id: Uuid;
  level: Level;
  subject: Subject;
  /** null = every board at this level. */
  board: Board | null;
  created_at: Timestamp;
}

/**
 * public.product_prices — immutable once made.
 *
 * - `billing_interval` set: recurring, one period of access per payment.
 * - `access_days` set: one-off, that many days of access.
 * - both null: one-off, access for good.
 */
export interface ProductPrice {
  id: Uuid;
  product_id: Uuid;
  currency: Currency;
  amount_pence: Pence;
  billing_interval: BillingInterval | null;
  access_days: number | null;
  stripe_price_id: string | null;
  active: boolean;
  created_at: Timestamp;
}

// --- Accounts and the ledger -------------------------------------------------

export const LEDGER_TRANSACTION_KINDS = [
  "card_purchase",
  "credit_purchase",
  "credit_grant",
  "refund",
  "adjustment",
] as const;
export type LedgerTransactionKind = (typeof LEDGER_TRANSACTION_KINDS)[number];

/** The kinds that buy access (and appear in product_entitlements). */
export const PURCHASE_KINDS = [
  "card_purchase",
  "credit_purchase",
] as const satisfies readonly LedgerTransactionKind[];
export type PurchaseKind = (typeof PURCHASE_KINDS)[number];

export const LEDGER_ENTRY_TYPES = [
  "card_payment",
  "purchase",
  "credit_grant",
  "refund",
  "card_refund",
  "adjustment",
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const REFUND_DESTINATIONS = ["credit", "card"] as const;
export type RefundDestination = (typeof REFUND_DESTINATIONS)[number];

/** public.billing_accounts — one per payer; the tenant every ledger row belongs to. */
export interface BillingAccount {
  id: Uuid;
  /** null once the payer's profile has been deleted. */
  owner_id: Uuid | null;
  currency: Currency;
  created_at: Timestamp;
  /** Set when the owner's profile was deleted. */
  closed_at: Timestamp | null;
}

/** public.ledger_transactions — append-only, one row per request. */
export interface LedgerTransaction {
  id: Uuid;
  account_id: Uuid;
  kind: LedgerTransactionKind;
  idempotency_key: string;
  request_fingerprint: string;
  /** The student a purchase (or its refund) covers. */
  student_id: Uuid | null;
  product_id: Uuid | null;
  price_id: Uuid | null;
  /** Always positive: the value paid, granted, refunded or adjusted by. */
  amount_pence: Pence;
  reverses_transaction_id: Uuid | null;
  /** Stripe id (in_…, pi_…, re_…). */
  external_ref: string | null;
  memo: string | null;
  access_starts_at: Timestamp | null;
  /** null on a purchase = access for good. */
  access_ends_at: Timestamp | null;
  created_by: Uuid | null;
  created_at: Timestamp;
}

/** public.ledger_entries — append-only money movements, numbered per account. */
export interface LedgerEntry {
  id: number;
  transaction_id: Uuid;
  account_id: Uuid;
  seq: number;
  entry_type: LedgerEntryType;
  /** Signed: positive adds to store credit, negative takes from it. */
  amount_pence: Pence;
  balance_after_pence: Pence;
  created_at: Timestamp;
}

/** public.product_entitlements (view) — unrefunded purchases and the access each bought. */
export interface ProductEntitlement {
  purchase_id: Uuid;
  account_id: Uuid;
  student_id: Uuid;
  product_id: Uuid;
  price_id: Uuid;
  starts_at: Timestamp;
  ends_at: Timestamp | null;
  purchased_at: Timestamp;
  is_current: boolean;
}

/**
 * A row of my_entitlements(): the caller's access, as the student it covers or
 * the payer. Access only, no money, so a child can see it.
 */
export type MyEntitlement = Omit<ProductEntitlement, "account_id" | "price_id">;

// --- Functions -----------------------------------------------------------------

/** What every ledger_* function returns (as a one-row array from `.rpc`). */
export interface LedgerPostResult {
  transaction_id: Uuid;
  /** The account's balance just after this transaction. */
  balance_pence: Pence;
  /** true when this key had already been used for the same request. */
  replayed: boolean;
}

/** ledger_purchase_with_credit — signed-in payers; spends their own credit. */
export interface PurchaseWithCreditArgs {
  p_price_id: Uuid;
  /** The caller, or a child linked to them. */
  p_student_id: Uuid;
  /** 8–190 of [A-Za-z0-9:._-]; stored as `client:<key>`. */
  p_idempotency_key: string;
}

/** ledger_record_card_purchase — service role only. */
export interface RecordCardPurchaseArgs {
  p_payer_id: Uuid;
  p_student_id: Uuid;
  p_price_id: Uuid;
  /** Above zero and no more than the price's amount. */
  p_amount_pence: Pence;
  /** The Stripe object paid (in_…/pi_…). Key on it too, not on the event. */
  p_external_ref: string;
  /** Must not start with `client:`. */
  p_idempotency_key: string;
  p_memo?: string | null;
  /** Recurring prices only, and then required: the invoice line's period. */
  p_period_start?: Timestamp | null;
  p_period_end?: Timestamp | null;
}

/** ledger_grant_credit — service role only. */
export interface GrantCreditArgs {
  p_owner_id: Uuid;
  p_amount_pence: Pence;
  p_idempotency_key: string;
  p_memo?: string | null;
}

/** ledger_refund — service role only; one full refund per purchase. */
export interface RefundArgs {
  p_transaction_id: Uuid;
  p_destination: RefundDestination;
  p_idempotency_key: string;
  /** Required for a refund to card: the Stripe re_… id. */
  p_external_ref?: string | null;
  p_memo?: string | null;
}

/** ledger_adjust — service role only; signed, with the reason in the memo. */
export interface AdjustArgs {
  p_owner_id: Uuid;
  p_amount_pence: Pence;
  p_memo: string;
  p_idempotency_key: string;
}

/** The functions as `.rpc(name, args)` sees them. */
export interface CommerceFunctions {
  ledger_purchase_with_credit: { Args: PurchaseWithCreditArgs; Returns: LedgerPostResult[] };
  my_credit_balance: { Args: Record<string, never>; Returns: Pence };
  my_entitlements: { Args: Record<string, never>; Returns: MyEntitlement[] };
  ledger_record_card_purchase: { Args: RecordCardPurchaseArgs; Returns: LedgerPostResult[] };
  ledger_grant_credit: { Args: GrantCreditArgs; Returns: LedgerPostResult[] };
  ledger_refund: { Args: RefundArgs; Returns: LedgerPostResult[] };
  ledger_adjust: { Args: AdjustArgs; Returns: LedgerPostResult[] };
}
