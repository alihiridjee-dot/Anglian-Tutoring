import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Check, Copy, RefreshCw, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ErrorNote, Spinner } from "@/components/Shared";
import { cn } from "@/lib/utils";
import type { Cadence } from "@/lib/billing/entitlements";
import {
  createParentJoinLink,
  parentJoinLinkStatus,
  parentJoinUrl,
  type ParentJoinStatus,
} from "@/lib/billing/parentJoin";

/** How often the waiting screen asks whether the parent has joined or paid. */
const POLL_MS = 4000;

/**
 * "My parent is paying", on the plan page: a one-time link as a QR code for
 * the parent's phone, and a trail that ticks off as they sign up and pay. The
 * moment the payment lands, `onPaid` hands over to the page's own welcome.
 */
export function ParentPaysPanel({
  cadence,
  onPaid,
  onClose,
}: {
  cadence: Cadence;
  onPaid: () => void;
  onClose: () => void;
}) {
  const make = useMutation({ mutationFn: () => createParentJoinLink(cadence) });
  const token = make.data?.token ?? null;
  // One link per opening. Closing and opening again makes a fresh one, and
  // the server kills the one before.
  useEffect(() => {
    make.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: link } = useQuery({
    queryKey: ["parent-join", "status", token],
    queryFn: () => parentJoinLinkStatus(token!),
    enabled: !!token,
    refetchInterval: (q) =>
      q.state.data?.status === "expired" || q.state.data?.status === "not_found" ? false : POLL_MS,
  });
  const { data: paid } = useQuery({
    queryKey: ["parent-join", "access"],
    queryFn: async () => {
      const { data } = await supabase.rpc("my_access_state").single();
      return !!data?.has_access;
    },
    enabled: !!token,
    refetchInterval: POLL_MS,
  });
  useEffect(() => {
    if (paid) onPaid();
  }, [paid, onPaid]);

  const dead = link?.status === "expired" || link?.status === "not_found";

  return (
    <div className="point-panel mt-7">
      {make.isPending ? (
        <Spinner label="Making your link" className="py-10" />
      ) : make.error ? (
        <ErrorNote error={make.error} onRetry={() => make.mutate()} />
      ) : token && dead ? (
        <div className="text-center">
          <h2 className="text-xl font-bold">This link has run out</h2>
          <p className="mt-2 text-[0.9375rem]">A link works once, for 24 hours.</p>
          <button
            type="button"
            onClick={() => make.mutate()}
            className="btn-solid mt-5 inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold"
          >
            <RefreshCw className="size-4" aria-hidden /> Make a new link
          </button>
        </div>
      ) : token ? (
        <LinkReady url={parentJoinUrl(token)} link={link} />
      ) : null}

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline sm:pointer-fine:min-h-0"
        >
          I&apos;ll pay myself instead
        </button>
      </div>
    </div>
  );
}

function LinkReady({ url, link }: { url: string; link: ParentJoinStatus | undefined }) {
  const joined = link?.status === "joined";
  const parent = (joined && link.parent_name?.split(" ")[0]) || "Your parent";
  return (
    <>
      {/* Used, the code is spent: say who has it instead. */}
      {joined ? (
        <div className="text-center">
          <h2 className="text-xl font-bold">{parent} is paying on their phone</h2>
          <p className="mt-2 text-[0.9375rem] leading-relaxed">
            This page opens by itself when they&apos;re done.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
          <div className="premium-card shrink-0 rounded-2xl p-3">
            <QRCodeSVG value={url} size={176} marginSize={1} title="Link for your parent" />
          </div>
          <div className="min-w-0 text-center sm:text-left">
            <h2 className="text-xl font-bold">Scan with your parent&apos;s phone</h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed">
              They make a parent account and pay on their phone. This page opens by itself when
              they&apos;re done. The link works once, for 24 hours.
            </p>
            <ShareButtons url={url} />
          </div>
        </div>
      )}

      <Trail
        stops={[
          {
            label: "Sign up",
            emoji: "🙋",
            word: joined ? `${parent} joined` : "Waiting",
            state: joined ? "done" : "now",
          },
          {
            label: "Pay",
            emoji: "💳",
            word: joined ? "Paying…" : "Next",
            state: joined ? "now" : "later",
          },
          { label: "You're in", emoji: "🚀", word: "Straight away", state: "later" },
        ]}
      />
    </>
  );
}

/** Copy, and on a phone the share sheet, for a parent who isn't in the room. */
function ShareButtons({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Share the QR code instead.");
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "Set up my Anglia Educate plan", url });
    } catch {
      /* Closed the share sheet: nothing to do. */
    }
  };
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
      <button
        type="button"
        onClick={copy}
        className="btn-soft inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy link"}
      </button>
      {canShare && (
        <button
          type="button"
          onClick={share}
          className="btn-soft inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm"
        >
          <Share2 className="size-4" /> Share
        </button>
      )}
    </div>
  );
}

type Stop = { label: string; emoji: string; word: string; state: "done" | "now" | "later" };

/** The house trail (README, "A page of work is a trail"), as a progress line. */
function Trail({ stops }: { stops: Stop[] }) {
  return (
    <ol
      aria-label="Where it's up to"
      className="point-trail point-trail-static mt-8 mb-0"
      style={{ "--stops": stops.length } as React.CSSProperties}
    >
      <TrailLine gaps={stops.length - 1} />
      {stops.map((s) => (
        <li
          key={s.label}
          className={cn("point-stop", s.state === "done" && "tint-emerald")}
          data-state={s.state === "done" ? "open" : "waiting"}
          aria-current={s.state === "now" ? "step" : undefined}
        >
          <span className="point-stop-dot">
            {s.state === "now" ? (
              <Spinner compact label={s.word} />
            ) : (
              <span aria-hidden>{s.state === "done" ? "✅" : s.emoji}</span>
            )}
          </span>
          <span className="point-stop-label">{s.label}</span>
          <span className="point-stop-word">{s.word}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The dotted line between the stops: SpecPointDetail's TrailPath, drawn here
 * rather than imported, so the plan page doesn't load the spec point page.
 */
function TrailLine({ gaps }: { gaps: number }) {
  let d = "M0 20";
  for (let i = 0; i < gaps; i++) {
    const x = i * 100;
    const [up, down] = i % 2 ? [36, 4] : [4, 36];
    d += ` C${x + 30} ${up} ${x + 70} ${down} ${x + 100} 20`;
  }
  return (
    <svg
      aria-hidden
      className="point-trail-path"
      viewBox={`0 0 ${gaps * 100} 40`}
      preserveAspectRatio="none"
    >
      <path d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
