// An in-memory stand-in for the slice of the Stripe SDK the billing edge
// functions use, mapped over "https://esm.sh/stripe@17.5.0?target=deno" by the
// import map in this folder. No network.
//
// SDK objects are loosely shaped by nature, so `any` is allowed in this file.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const STRIPE = {
  subs: new Map<string, any>(),
  sessions: new Map<string, any>(),
  invoices: new Map<string, any>(),
  refunds: [] as { id: string; payment_intent: string; idempotencyKey?: string }[],
  customers: new Map<string, any>(),
  n: 0,
  calls: [] as string[],
  /** How many upcoming subscriptions.retrieve calls fail as if Stripe were down. */
  failRetrieves: 0,
  /** How many upcoming checkout.sessions.retrieve calls fail the same way. */
  failSessionRetrieves: 0,
  /** How many upcoming subscriptions.update or .cancel calls fail the same way. */
  failUpdates: 0,
  /** The card on file refuses every charge made now (a prorated swap). */
  declineCharges: false,
  /**
   * subscription id -> run once by the next subscriptions.retrieve of it,
   * after it has read Stripe and before it answers: another delivery
   * overtaking a slow read.
   */
  onRetrieve: new Map<string, () => Promise<unknown>>(),
};

export function resetStripe() {
  STRIPE.subs.clear();
  STRIPE.sessions.clear();
  STRIPE.invoices.clear();
  STRIPE.refunds = [];
  STRIPE.customers.clear();
  STRIPE.n = 0;
  STRIPE.calls = [];
  STRIPE.failRetrieves = 0;
  STRIPE.failSessionRetrieves = 0;
  STRIPE.failUpdates = 0;
  STRIPE.declineCharges = false;
  STRIPE.onRetrieve.clear();
}

/** Open a Checkout Session as stripe-checkout would, for completeSession to pay. */
export function openSession(metadata: Record<string, string>, trialDays?: number) {
  const id = `cs_${++STRIPE.n}`;
  STRIPE.sessions.set(id, {
    id,
    status: "open",
    customer: `cus_${metadata.payer_id}`,
    created: now(),
    line_items: [{ price: "price_m1" }],
    metadata,
    subscription_data: { metadata, ...(trialDays ? { trial_period_days: trialDays } : {}) },
  });
  return id;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const missing = (what: string) =>
  Object.assign(new Error(`No such ${what}`), { code: "resource_missing", statusCode: 404 });
const now = () => Math.floor(Date.now() / 1000);

/**
 * The family pays a Checkout Session: Stripe creates the subscription and its
 * first invoice (nothing charged for a trial). Returns the events Stripe sends.
 */
export function completeSession(sessionId: string) {
  const s = STRIPE.sessions.get(sessionId);
  if (!s || s.status !== "open") throw new Error(`session ${sessionId} is not open`);
  const id = `sub_${++STRIPE.n}`;
  // A trial by length, or one that ends on a set day (a take-over).
  const trialEnd: number | undefined = s.subscription_data?.trial_end;
  const trial = s.subscription_data?.trial_period_days || (trialEnd ? 1 : 0);
  const end = trialEnd ?? now() + (trial ? trial * 86400 : 30 * 86400);
  const invoiceId = `in_${++STRIPE.n}`;
  STRIPE.invoices.set(invoiceId, {
    id: invoiceId,
    subscription: id,
    amount_paid: trial ? 0 : 4999,
    payment_intent: trial ? null : `pi_${++STRIPE.n}`,
  });
  const sub = {
    id,
    object: "subscription",
    customer: s.customer,
    status: trial ? "trialing" : "active",
    created: now(),
    ended_at: null as number | null,
    cancel_at_period_end: false,
    pause_collection: null,
    current_period_end: end,
    trial_end: trial ? end : null,
    latest_invoice: invoiceId,
    metadata: { ...(s.subscription_data?.metadata ?? {}) },
    items: {
      data: [{ id: `si_${id}`, price: { id: s.line_items[0].price }, current_period_end: end }],
    },
  };
  STRIPE.subs.set(id, sub);
  s.status = "complete";
  s.subscription = id;
  return {
    completed: event("checkout.session.completed", s),
    created: event("customer.subscription.created", sub),
  };
}

/** A copy of each item, handed out by `for await`. */
function iterate(items: any[]) {
  const copies = items.map(clone);
  return {
    async *[Symbol.asyncIterator]() {
      yield* copies;
    },
  };
}

export function event(type: string, object: unknown) {
  return { id: `evt_${++STRIPE.n}`, type, data: { object: clone(object) } };
}

export default class Stripe {
  constructor(_key: string, _opts?: unknown) {}

  webhooks = {
    constructEventAsync: async (body: string, _sig: string, _secret: string) => JSON.parse(body),
  };

  subscriptions = {
    retrieve: async (id: string) => {
      STRIPE.calls.push(`subscriptions.retrieve ${id}`);
      if (STRIPE.failRetrieves > 0) {
        STRIPE.failRetrieves--;
        throw Object.assign(new Error("An error occurred with our connection to Stripe."), {
          code: "api_connection_error",
        });
      }
      const s = STRIPE.subs.get(id);
      if (!s) throw missing(`subscription: '${id}'`);
      const read = clone(s);
      const overtake = STRIPE.onRetrieve.get(id);
      if (overtake) {
        STRIPE.onRetrieve.delete(id);
        await overtake();
      }
      return read;
    },
    update: async (id: string, p: any) => {
      STRIPE.calls.push(`subscriptions.update ${id}`);
      if (STRIPE.failUpdates > 0) {
        STRIPE.failUpdates--;
        throw Object.assign(new Error("An error occurred with our connection to Stripe."), {
          code: "api_connection_error",
        });
      }
      const s = STRIPE.subs.get(id);
      if (!s) throw missing(`subscription: '${id}'`);
      if (STRIPE.declineCharges && p.proration_behavior === "always_invoice") {
        if (p.payment_behavior === "error_if_incomplete") {
          throw Object.assign(new Error("Your card was declined."), {
            type: "StripeCardError",
            statusCode: 402,
            code: "card_declined",
          });
        }
        // Stripe's default: the swap applies and its unpaid invoice tips the plan over.
        s.status = "past_due";
      }
      if ("pause_collection" in p)
        s.pause_collection = p.pause_collection === "" ? null : p.pause_collection;
      if ("cancel_at_period_end" in p) s.cancel_at_period_end = p.cancel_at_period_end;
      // A trial's end is its period end, on the subscription and its item.
      if ("trial_end" in p && s.status === "trialing") {
        s.trial_end = p.trial_end;
        s.current_period_end = p.trial_end;
        for (const item of s.items?.data ?? []) item.current_period_end = p.trial_end;
      }
      if (p.items) {
        for (const change of p.items) {
          const item = s.items?.data?.find((i: any) => i.id === change.id);
          if (item && change.price) item.price = { id: change.price };
        }
      }
      if (p.metadata) s.metadata = { ...p.metadata };
      return clone(s);
    },
    // Iterated with `for await`, like the SDK's auto-paging list.
    list: (p: { customer?: string }) =>
      iterate([...STRIPE.subs.values()].filter((s) => !p?.customer || s.customer === p.customer)),
    cancel: async (id: string, _p?: unknown) => {
      STRIPE.calls.push(`subscriptions.cancel ${id}`);
      if (STRIPE.failUpdates > 0) {
        STRIPE.failUpdates--;
        throw Object.assign(new Error("An error occurred with our connection to Stripe."), {
          code: "api_connection_error",
        });
      }
      const s = STRIPE.subs.get(id);
      if (!s) throw missing(`subscription: '${id}'`);
      if (s.status === "canceled") throw new Error(`subscription ${id} is already canceled`);
      s.status = "canceled";
      s.ended_at = now();
      return clone(s);
    },
  };

  invoices = {
    retrieve: async (id: string) => {
      const i = STRIPE.invoices.get(id);
      if (!i) throw missing(`invoice: '${id}'`);
      return clone(i);
    },
    retrieveUpcoming: async () => ({ amount_due: 0, currency: "gbp" }),
    // The customer's invoices, newest first, capped as Stripe does.
    list: async (p: { customer?: string; limit?: number }) => {
      STRIPE.calls.push(`invoices.list ${p?.customer}`);
      const data = [...STRIPE.invoices.values()]
        .filter((i) => i.customer && i.customer === p?.customer)
        .sort((a, b) => b.created - a.created)
        .slice(0, p?.limit ?? 10)
        .map(clone);
      return { data };
    },
  };

  refunds = {
    list: async (p: { payment_intent: string }) => ({
      data: STRIPE.refunds.filter((r) => r.payment_intent === p.payment_intent),
    }),
    create: async (p: { payment_intent: string }, opts?: { idempotencyKey?: string }) => {
      STRIPE.calls.push(`refunds.create ${p.payment_intent}`);
      const again = STRIPE.refunds.find(
        (r) => opts?.idempotencyKey && r.idempotencyKey === opts.idempotencyKey,
      );
      if (again) return clone(again);
      if (STRIPE.refunds.some((r) => r.payment_intent === p.payment_intent)) {
        throw Object.assign(new Error("Charge has already been refunded."), {
          code: "charge_already_refunded",
        });
      }
      const refund = {
        id: `re_${++STRIPE.n}`,
        payment_intent: p.payment_intent,
        idempotencyKey: opts?.idempotencyKey,
      };
      STRIPE.refunds.push(refund);
      return clone(refund);
    },
  };

  checkout = {
    sessions: {
      create: async (p: any) => {
        const id = `cs_${++STRIPE.n}`;
        STRIPE.calls.push(`checkout.sessions.create ${id}`);
        const s = {
          id,
          url: `https://checkout.stripe.test/${id}`,
          status: "open",
          subscription: null,
          created: now(),
          ...clone(p),
        };
        STRIPE.sessions.set(id, s);
        return clone(s);
      },
      retrieve: async (id: string) => {
        if (STRIPE.failSessionRetrieves > 0) {
          STRIPE.failSessionRetrieves--;
          throw Object.assign(new Error("An error occurred with our connection to Stripe."), {
            code: "api_connection_error",
          });
        }
        const s = STRIPE.sessions.get(id);
        if (!s) throw missing(`checkout.session: '${id}'`);
        return clone(s);
      },
      list: (p: { customer?: string; status?: string }) =>
        iterate(
          [...STRIPE.sessions.values()].filter(
            (s) =>
              (!p?.customer || s.customer === p.customer) && (!p?.status || s.status === p.status),
          ),
        ),
      expire: async (id: string) => {
        STRIPE.calls.push(`checkout.sessions.expire ${id}`);
        const s = STRIPE.sessions.get(id);
        if (!s) throw missing(`checkout.session: '${id}'`);
        if (s.status !== "open") throw new Error(`session ${id} is ${s.status}, can't expire`);
        s.status = "expired";
        return clone(s);
      },
    },
  };

  customers = {
    create: async (p: any, opts?: { idempotencyKey?: string }) => {
      const again = [...STRIPE.customers.values()].find(
        (c) => opts?.idempotencyKey && c.idempotencyKey === opts.idempotencyKey,
      );
      if (again) return { id: again.id };
      const id = `cus_${++STRIPE.n}`;
      STRIPE.customers.set(id, { id, ...clone(p), idempotencyKey: opts?.idempotencyKey });
      return { id };
    },
  };

  billingPortal = { sessions: { create: async () => ({ url: "https://billing.stripe.test/p" }) } };
}
