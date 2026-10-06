import { ChevronDown, Download, ExternalLink, Receipt } from "lucide-react";
import { useInvoices } from "@/hooks/data/useBilling";
import { formatPence } from "@/lib/billing/billing";
import { Spinner } from "@/components/Shared";

/**
 * The signed-in payer's Stripe payment history. Students who have never paid
 * (their parent does) simply see nothing here, so callers should only render
 * this for accounts that actually pay.
 */
export function InvoiceHistory() {
  const { data: invoices, isLoading, error } = useInvoices();

  if (isLoading) {
    return <Spinner label="Loading payment history" className="py-8" />;
  }
  if (error) {
    return <p className="text-sm text-rose-600">Couldn't load payment history: {error.message}</p>;
  }
  if (!invoices || invoices.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No payments yet — your first invoice will appear here.
      </p>
    );
  }

  return (
    <>
      {/* A phone gets one invoice per row. The five-column table was 544px
          wide in a sideways-scrolling box, so the amount, status and receipt
          started off a phone's screen. */}
      <ul className="divide-y divide-border/60 text-sm sm:hidden">
        {invoices.map((inv) => (
          <li key={inv.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{invoiceDate(inv)}</p>
                <p className="break-words">{invoiceLabel(inv)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-semibold">{invoiceAmount(inv)}</span>
                <StatusChip status={inv.status} />
              </div>
            </div>
            <ReceiptLinks inv={inv} />
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm sm:table">
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
              <td className="py-3 pr-4 whitespace-nowrap">{invoiceDate(inv)}</td>
              <td className="py-3 pr-4 text-muted-foreground">{invoiceLabel(inv)}</td>
              <td className="py-3 pr-4 font-semibold whitespace-nowrap">{invoiceAmount(inv)}</td>
              <td className="py-3 pr-4">
                <StatusChip status={inv.status} />
              </td>
              <td className="py-3 text-right whitespace-nowrap">
                <ReceiptLinks inv={inv} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

type Invoice = NonNullable<ReturnType<typeof useInvoices>["data"]>[number];

const invoiceDate = (inv: Invoice) => new Date(inv.created * 1000).toLocaleDateString();
const invoiceLabel = (inv: Invoice) => inv.description ?? inv.number ?? "Subscription";
const invoiceAmount = (inv: Invoice) =>
  formatPence(inv.amount_paid || inv.amount_due, inv.currency);

/** The kit's chip, tinted by state: paid green, still open amber. */
function StatusChip({ status }: { status: Invoice["status"] }) {
  const tint = status === "paid" ? "tint-emerald" : status === "open" ? "tint-amber" : "tint-slate";
  return <span className={`chip ${tint} uppercase`}>{status ?? "—"}</span>;
}

function ReceiptLinks({ inv }: { inv: Invoice }) {
  return (
    <>
      {inv.hosted_invoice_url && (
        <a
          href={inv.hosted_invoice_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline font-semibold mr-3 sm:pointer-fine:min-h-0"
        >
          View <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {inv.invoice_pdf && (
        <a
          href={inv.invoice_pdf}
          className="inline-flex min-h-11 items-center gap-1 text-primary hover:underline font-semibold sm:pointer-fine:min-h-0"
        >
          PDF <Download className="w-3 h-3" />
        </a>
      )}
    </>
  );
}

/**
 * Card wrapper used by both the billing page and the parent dashboard. Closed
 * by default: past invoices are looked up now and then, not read every visit.
 */
export function InvoiceHistoryCard() {
  return (
    <details className="group premium-card rounded-2xl p-4 sm:p-6">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 sm:pointer-fine:min-h-0 [&::-webkit-details-marker]:hidden">
        <span className="icon-tile size-8 shrink-0">
          <Receipt className="size-4" aria-hidden />
        </span>
        <h2 className="font-display flex-1 text-xl font-bold">Payment history</h2>
        <ChevronDown className="size-5 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-4">
        <InvoiceHistory />
      </div>
    </details>
  );
}
