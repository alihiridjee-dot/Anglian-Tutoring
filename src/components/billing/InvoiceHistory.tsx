import { Download, ExternalLink, Receipt } from "lucide-react";
import { useInvoices } from "@/hooks/data/useBilling";
import { formatPence } from "@/lib/billing";

/**
 * The signed-in payer's Stripe payment history. Students who have never paid
 * (their parent does) simply see nothing here, so callers should only render
 * this for accounts that actually pay.
 */
export function InvoiceHistory() {
  const { data: invoices, isLoading, error } = useInvoices();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading payment history…</p>;
  }
  if (error) {
    return <p className="text-sm text-rose-600">Couldn't load payment history: {error.message}</p>;
  }
  if (!invoices || invoices.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="py-2 pr-4 font-semibold">Date</th>
            <th className="py-2 pr-4 font-semibold">Description</th>
            <th className="py-2 pr-4 font-semibold">Amount</th>
            <th className="py-2 pr-4 font-semibold">Status</th>
            <th className="py-2 font-semibold text-right">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-b border-border/60 last:border-0">
              <td className="py-3 pr-4 whitespace-nowrap">
                {new Date(inv.created * 1000).toLocaleDateString()}
              </td>
              <td className="py-3 pr-4 text-muted-foreground">
                {inv.description ?? inv.number ?? "Subscription"}
              </td>
              <td className="py-3 pr-4 font-semibold whitespace-nowrap">
                {formatPence(inv.amount_paid || inv.amount_due, inv.currency)}
              </td>
              <td className="py-3 pr-4">
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${
                    inv.status === "paid"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : inv.status === "open"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-slate-50 text-slate-600 border-slate-200"
                  }`}
                >
                  {inv.status ?? "—"}
                </span>
              </td>
              <td className="py-3 text-right whitespace-nowrap">
                {inv.hosted_invoice_url && (
                  <a
                    href={inv.hosted_invoice_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline font-semibold mr-3"
                  >
                    View <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {inv.invoice_pdf && (
                  <a
                    href={inv.invoice_pdf}
                    className="inline-flex items-center gap-1 text-primary hover:underline font-semibold"
                  >
                    PDF <Download className="w-3 h-3" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Card wrapper used by both the billing page and the parent dashboard. */
export function InvoiceHistoryCard() {
  return (
    <div className="rounded-2xl bg-card border border-border p-6">
      <div className="flex items-center gap-3 mb-4">
        <Receipt className="w-5 h-5 text-primary" />
        <h2 className="font-display text-xl font-semibold">Payment history</h2>
      </div>
      <InvoiceHistory />
    </div>
  );
}
