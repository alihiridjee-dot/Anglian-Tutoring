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
};

export function resetStripe() {
  STRIPE.subs.clear();
  STRIPE.sessions.clear();
  STRIPE.invoices.clear();
  STRIPE.refunds = [];
  STRIPE.customers.clear();
  STRIPE.n = 0;
  STRIPE.calls = [];
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
  const trial = s.subscription_data?.trial_period_days;
  const end = now() + (trial ? trial * 86400 : 30 * 86400);
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
    cancel_at_period_end: false,
    pause_collection: null,
    current_period_end: end,
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
      const s = STRIPE.subs.get(id);
      if (!s) throw missing(`subscription: '${id}'`);
      return clone(s);
    },
    update: async (id: string, p: any) => {
      STRIPE.calls.push(`subscriptions.update ${id}`);
      const s = STRIPE.subs.get(id);
      if (!s) throw missing(`subscription: '${id}'`);
      if ("pause_collection" in p)
        s.pause_collection = p.pause_collection === "" ? null : p.pause_collection;
      if ("cancel_at_period_end" in p) s.cancel_at_period_end = p.cancel_at_period_end;
      return clone(s);
    },
    cancel: async (id: string) => {
      STRIPE.calls.push(`subscriptions.cancel ${id}`);
      const s = STRIPE.subs.get(id);
      if (!s) throw missing(`subscription: '${id}'`);
      if (s.status === "canceled") throw new Error(`subscription ${id} is already canceled`);
      s.status = "canceled";
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
    list: async () => ({ data: [] }),
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
        const s = STRIPE.sessions.get(id);
        if (!s) throw missing(`checkout.session: '${id}'`);
        return clone(s);
      },
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
    create: async (p: any) => {
      const id = `cus_${++STRIPE.n}`;
      STRIPE.customers.set(id, { id, ...clone(p) });
      return { id };
    },
  };

  billingPortal = { sessions: { create: async () => ({ url: "https://billing.stripe.test/p" }) } };
}
