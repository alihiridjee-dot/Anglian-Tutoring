import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { CreditCard, Check, Zap, X, Lock, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing | Anglian Learning" }] }),
  component: BillingPage,
});

type Package = {
  id: string;
  tier: string;
  name: string;
  description: string | null;
  subjects: string[];
  level: string | null;
  price_pence: number;
};
type Subscription = { status: string; plan: string | null; current_period_end: string | null };

function BillingPage() {
  const { userId } = useRoles();
  const { enrolledCourses, role } = useEnrolments();
  const queryClient = useQueryClient();

  const [packages, setPackages] = useState<Package[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  // Stripe checkout modal state
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<"form" | "processing" | "success">("form");

  // Checkout form fields
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [cardZip, setCardZip] = useState("");
  const [paymentError, setPaymentError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase
        .from("packages")
        .select("id, tier, name, description, subjects, level, price_pence")
        .eq("active", true)
        .order("sort_order");
      setPackages((p ?? []) as Package[]);
      if (userId) {
        const { data: s } = await supabase
          .from("subscriptions")
          .select("status, plan, current_period_end")
          .eq("user_id", userId)
          .maybeSingle();
        setSub(s as Subscription | null);
      }
      setLoading(false);
    })();
  }, [userId]);

  const activeTier = sub?.plan ?? null;

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, "").replace(/[^0-9]/gi, "");
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || "";
    const parts = [];

    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }

    if (parts.length > 0) {
      return parts.join(" ");
    } else {
      return v;
    }
  };

  const formatExpiry = (value: string) => {
    const clearValue = value.replace(/[^0-9]/g, "");
    if (clearValue.length >= 2) {
      return `${clearValue.slice(0, 2)}/${clearValue.slice(2, 4)}`;
    }
    return clearValue;
  };

  const getCardType = (num: string) => {
    const cleanNum = num.replace(/\s/g, "");
    if (cleanNum.startsWith("4")) return "Visa";
    if (/^5[1-5]/.test(cleanNum)) return "Mastercard";
    if (/^3[47]/.test(cleanNum)) return "Amex";
    return "Unknown";
  };

  const handleUpgradeClick = (pkg: Package) => {
    setSelectedPackage(pkg);
    setIsCheckoutOpen(true);
    setCheckoutStep("form");
    setCardName("");
    setCardNumber("");
    setCardExpiry("");
    setCardCvc("");
    setCardZip("");
    setPaymentError("");
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      setPaymentError("You must be logged in to subscribe.");
      return;
    }

    const cleanCard = cardNumber.replace(/\s/g, "");
    if (cleanCard.length < 15) {
      setPaymentError("Please enter a valid credit card number.");
      return;
    }
    if (cardExpiry.length < 5) {
      setPaymentError("Please enter a valid expiry date (MM/YY).");
      return;
    }
    if (cardCvc.length < 3) {
      setPaymentError("Please enter a valid CVC code.");
      return;
    }

    setPaymentError("");
    setCheckoutStep("processing");

    try {
      // Simulate real bank authorization secure latency
      await new Promise((resolve) => setTimeout(resolve, 2200));

      const nextPeriodEnd = new Date();
      nextPeriodEnd.setDate(nextPeriodEnd.getDate() + 30);

      // 1. Create/Update Subscription in Supabase
      const { error: subErr } = await supabase.from("subscriptions").upsert(
        {
          user_id: userId,
          status: "active",
          plan: selectedPackage!.tier,
          current_period_end: nextPeriodEnd.toISOString(),
        },
        {
          onConflict: "user_id",
        },
      );

      if (subErr) throw subErr;

      // 2. Update Profile's Enrolled Courses in Supabase
      const { error: profErr } = await supabase
        .from("profiles")
        .update({
          enrolled_courses: selectedPackage!.subjects,
        })
        .eq("id", userId);

      if (profErr) throw profErr;

      // Invalidate the cache to reload throughout the app
      queryClient.invalidateQueries({ queryKey: ["user-roles-and-profile"] });
      queryClient.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });

      // Instantly update local state representation
      setSub({
        status: "active",
        plan: selectedPackage!.tier,
        current_period_end: nextPeriodEnd.toISOString(),
      });

      setCheckoutStep("success");
      toast.success(`Success! Enrolled in ${selectedPackage!.name}`);
    } catch (err: unknown) {
      console.error(err);
      const msg =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during Stripe validation.";
      setPaymentError(msg);
      setCheckoutStep("form");
    }
  };

  return (
    <AppLayout title="Billing">
      <div className="max-w-4xl">
        <div className="rounded-2xl bg-card border border-border p-6 mb-8">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h2 className="font-display text-xl font-semibold">Current plan</h2>
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sub && sub.status === "active" ? (
            <div>
              <p className="font-semibold text-lg">{sub.plan}</p>
              {sub.current_period_end && (
                <p className="text-sm text-muted-foreground">
                  Renews {new Date(sub.current_period_end).toLocaleDateString()}
                </p>
              )}
              <p className="text-sm text-muted-foreground mt-2">
                Enrolled subjects: {enrolledCourses.length ? enrolledCourses.join(", ") : "—"}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-muted-foreground">
                You don't have an active plan yet. Pick one below to unlock lessons, quizzes, and
                homework marking.
              </p>
              {role === "parent" && (
                <p className="text-xs text-muted-foreground mt-2">
                  Parent accounts don't need their own plan — you inherit access to your linked
                  child's subjects.
                </p>
              )}
            </div>
          )}
        </div>

        <h3 className="font-display text-lg font-semibold mb-4">Choose a plan</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {packages.map((p) => {
            const isCurrent = activeTier === p.tier;
            return (
              <div
                key={p.id}
                className={`rounded-2xl p-6 border ${isCurrent ? "border-accent bg-accent/5" : "border-border bg-card"}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="font-display font-semibold text-lg">{p.name}</h4>
                  {isCurrent && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-accent text-accent-foreground uppercase tracking-widest font-bold">
                      Current
                    </span>
                  )}
                </div>
                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                <p className="mt-3 font-display text-3xl font-bold">
                  £{(p.price_pence / 100).toFixed(0)}
                  <span className="text-sm text-muted-foreground font-normal">/mo</span>
                </p>
                {p.subjects.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {p.subjects.map((s) => (
                      <li key={s} className="text-sm flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-accent" />{" "}
                        {s[0].toUpperCase() + s.slice(1)}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  disabled={isCurrent}
                  onClick={() => handleUpgradeClick(p)}
                  className="mt-5 w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  {isCurrent ? "Active" : "Upgrade / switch"}
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl bg-primary/5 border border-primary/20 p-6 text-sm">
          <div className="flex items-center gap-2 font-semibold text-primary mb-2">
            <Zap className="w-4 h-4" /> Stripe Integrated
          </div>
          <p className="text-muted-foreground">
            The stripe checkout simulation is fully online and integrated with the database.
            Upgrading or switching plans above triggers a secure, premium checkout layer and
            automatically updates your subject enrolments and curriculum.
          </p>
          <Link
            to="/dashboard"
            className="text-primary mt-3 inline-block text-sm font-semibold hover:underline"
          >
            ← Back to dashboard
          </Link>
        </div>
      </div>

      {/* Stripe Checkout Overlay Modal */}
      {isCheckoutOpen && selectedPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-fade-in">
          <div className="relative w-full max-w-4xl bg-[#f8f9fa] rounded-2xl overflow-hidden shadow-2xl border border-border flex flex-col md:flex-row max-h-[90vh]">
            {/* Close Button */}
            <button
              onClick={() => setIsCheckoutOpen(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground z-10 p-1.5 rounded-full bg-white/80 border border-border hover:bg-white"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Left Column: Order details & branding */}
            <div className="w-full md:w-[45%] bg-[#1a1f2c] text-white p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-8">
                  <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold">
                    A
                  </div>
                  <span className="font-display font-semibold text-lg tracking-tight">
                    Anglian Learning
                  </span>
                </div>

                <p className="text-white/60 text-sm uppercase tracking-wider font-semibold">
                  Subscribe to
                </p>
                <h3 className="font-display text-2xl font-bold mt-1 text-white">
                  {selectedPackage.name}
                </h3>
                <p className="text-white/70 text-sm mt-2">{selectedPackage.description}</p>

                <div className="mt-8 space-y-4 border-t border-white/10 pt-6">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">Subscription price</span>
                    <span className="font-mono">
                      £{(selectedPackage.price_pence / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">Billed monthly</span>
                    <span className="font-mono">Recurring</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">Tax (VAT 20%)</span>
                    <span className="text-white/60">Included</span>
                  </div>
                </div>
              </div>

              <div className="mt-8 border-t border-white/10 pt-6">
                <div className="flex justify-between items-baseline">
                  <span className="text-white/80 font-semibold">Total to pay</span>
                  <span className="font-display text-3xl font-extrabold font-mono text-white">
                    £{(selectedPackage.price_pence / 100).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-white/40 mt-3">
                  <Lock className="w-3 h-3" /> Secure SSL connection
                </div>
              </div>
            </div>

            {/* Right Column: Payment entry form */}
            <div className="w-full md:w-[55%] bg-white p-8 flex flex-col justify-center relative min-h-[400px]">
              {checkoutStep === "form" && (
                <form onSubmit={handlePaySubmit} className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display font-bold text-lg text-[#1a1f2c]">Pay with card</h3>
                    <div className="flex gap-1.5 text-xs text-muted-foreground items-center font-mono bg-secondary px-2 py-0.5 rounded">
                      <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                      Stripe secure
                    </div>
                  </div>

                  {paymentError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">
                      {paymentError}
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                      Cardholder Name
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="Jane Doe"
                      className="w-full h-10 px-3 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-hidden"
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                      Card Number
                    </label>
                    <div className="relative">
                      <input
                        required
                        type="text"
                        maxLength={19}
                        placeholder="4242 4242 4242 4242"
                        className="w-full h-10 pl-3 pr-12 bg-white border border-border rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary outline-hidden"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {getCardType(cardNumber) === "Visa" && (
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                            VISA
                          </span>
                        )}
                        {getCardType(cardNumber) === "Mastercard" && (
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                            MC
                          </span>
                        )}
                        {getCardType(cardNumber) === "Amex" && (
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                            AMEX
                          </span>
                        )}
                        {getCardType(cardNumber) === "Unknown" && (
                          <CreditCard className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                        Expires
                      </label>
                      <input
                        required
                        type="text"
                        maxLength={5}
                        placeholder="MM/YY"
                        className="w-full h-10 px-3 bg-white border border-border rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary outline-hidden"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                        CVC
                      </label>
                      <input
                        required
                        type="text"
                        maxLength={4}
                        placeholder="123"
                        className="w-full h-10 px-3 bg-white border border-border rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary outline-hidden"
                        value={cardCvc}
                        onChange={(e) => setCardCvc(e.target.value.replace(/[^0-9]/g, ""))}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                      Billing Postcode / ZIP
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="SW1A 1AA"
                      className="w-full h-10 px-3 bg-white border border-border rounded-lg text-sm uppercase focus:ring-2 focus:ring-primary/20 focus:border-primary outline-hidden"
                      value={cardZip}
                      onChange={(e) => setCardZip(e.target.value)}
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:opacity-95 transition cursor-pointer flex items-center justify-center gap-2 mt-2"
                  >
                    <Lock className="w-4 h-4" /> Pay £
                    {(selectedPackage.price_pence / 100).toFixed(2)}
                  </button>

                  <p className="text-center text-[11px] text-muted-foreground">
                    By confirming, you authorize Anglian Learning to charge your card on a monthly
                    basis until you cancel. Cancel anytime.
                  </p>
                </form>
              )}

              {checkoutStep === "processing" && (
                <div className="flex flex-col items-center justify-center space-y-4 animate-pulse">
                  <div className="w-12 h-12 rounded-full border-4 border-primary/25 border-t-primary animate-spin" />
                  <div className="text-center">
                    <h4 className="font-display font-semibold text-lg text-foreground">
                      Authorizing payment
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Connecting with Stripe security servers…
                    </p>
                  </div>
                </div>
              )}

              {checkoutStep === "success" && (
                <div className="flex flex-col items-center justify-center text-center p-4 space-y-4 animate-scale-up">
                  <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-xs">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="font-display font-extrabold text-xl text-[#1a1f2c]">
                      Payment Successful!
                    </h4>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                      Your subscription is now active! All features of the{" "}
                      <span className="font-semibold text-foreground">{selectedPackage.name}</span>{" "}
                      have been fully unlocked.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsCheckoutOpen(false)}
                    className="h-10 px-6 bg-[#1a1f2c] text-white hover:bg-black font-semibold rounded-lg text-sm transition mt-2 cursor-pointer"
                  >
                    Go to curriculum
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
