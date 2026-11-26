import { ChevronDown, Download, ExternalLink, Receipt } from "lucide-react";
import { useInvoices } from "@/hooks/data/useBilling";
import { formatPence } from "@/lib/billing/billing";
import { ErrorNote, Spinner } from "@/components/Shared";
import { DotWord } from "@/components/planner/workbench/figures";

/**
 * The signed-in payer's Stripe payment history, as bare rows: the amount large,
 * the date and what it was for under it, then a dot and a word for its state
 * and the receipt links. Students who have never paid (their parent does)
 * simply see "No payments yet".
 */
export function InvoiceHistory() {
  const { data: invoices, isLoading, error, refetch } = useInvoices();

  if (isLoading) {
    return <Spinner label="Loading payment history" className="py-8" />;
  }
  if (error) {
    return <ErrorNote error={error} onRetry={() => void refetch()} />;
  }
  if (!invoices || invoices.length === 0) {
    return <p className="font-semibold">No payments yet.</p>;
  }

  return (
    <ul>
      {invoices.map((inv) => (
        <li key={inv.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl p-3">
          <div className="min-w-0 flex-[1_1_12rem]">
            <p className="font-display text-xl font-bold">{invoiceAmount(inv)}</p>
            <p className="font-semibold break-words">
              {invoiceDate(inv)} · {invoiceLabel(inv)}
            </p>
          </div>
          <StatusWord status={inv.status} />
          <ReceiptLinks inv={inv} />
        </li>
      ))}
    </ul>
  );
}

type Invoice = NonNullable<ReturnType<typeof useInvoices>["data"]>[number];

const invoiceDate = (inv: Invoice) =>
  new Date(inv.created * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const invoiceLabel = (inv: Invoice) => inv.description ?? inv.number ?? "Subscription";
const invoiceAmount = (inv: Invoice) =>
  formatPence(inv.amount_paid || inv.amount_due, inv.currency);

const STATUS_WORD: Record<string, string> = {
  paid: "Paid",
  open: "Due",
  draft: "Draft",
  void: "Void",
  uncollectible: "Not paid",
};

/** A dot and a word, tinted by state: paid green, still due amber. */
function StatusWord({ status }: { status: Invoice["status"] }) {
  if (!status) return null;
  const tint = status === "paid" ? "tint-emerald" : status === "open" ? "tint-amber" : "tint-slate";
  return (
    <span className="font-bold">
      <DotWord tint={tint}>{STATUS_WORD[status] ?? status}</DotWord>
    </span>
  );
}

function ReceiptLinks({ inv }: { inv: Invoice }) {
  if (!inv.hosted_invoice_url && !inv.invoice_pdf) return null;
  return (
    <span className="flex gap-1">
      {inv.hosted_invoice_url && (
        <a
          href={inv.hosted_invoice_url}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold"
        >
          View <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
      {inv.invoice_pdf && (
        <a
          href={inv.invoice_pdf}
          className="btn-ghost inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold"
        >
          PDF <Download className="size-3.5" aria-hidden />
        </a>
      )}
    </span>
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
