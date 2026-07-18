import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Radio } from "lucide-react";
import { NextSessionCountdown } from "@/components/live/NextSessionCountdown";
import { fetchLiveSessions } from "@/lib/liveSessions";

const LIVE_TAIL_MS = 90 * 60_000;

/**
 * The student's live-sessions strip: a gently pulsing panel that shows the
 * next-session countdown when there is one, and otherwise an always-present
 * prompt into the Live Sessions surface. Pulled out of the "This Week" hub so it
 * can stand alone as its own dashboard banner as well as sit inside the hub.
 */
export function LiveSessionsBanner({
  to = "/live",
  plansPresent = false,
}: {
  to?: string;
  plansPresent?: boolean;
}) {
  return (
    <div className="relative rounded-2xl">
      <span className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-emerald-500/40 animate-pulse" />
      <div className="relative">
        <NextSessionCountdown className="!mb-0" />
        <LiveSessionsFallback to={to} plansPresent={plansPresent} />
      </div>
    </div>
  );
}

/**
 * Always-present live-sessions prompt shown beneath the countdown. The countdown
 * renders nothing when there's no upcoming session, so this guarantees the strip
 * always carries a visible route into Live Sessions. When a session is in the
 * live/upcoming window the countdown owns the strip and this steps aside.
 */
function LiveSessionsFallback({ to, plansPresent }: { to: string; plansPresent: boolean }) {
  const { data } = useQuery({
    queryKey: ["live", "countdown"],
    queryFn: () => fetchLiveSessions(),
  });
  const now = Date.now();
  const hasUpcoming = (data ?? []).some(
    (s) => s.starts_at && new Date(s.starts_at).getTime() + LIVE_TAIL_MS > now,
  );
  if (hasUpcoming) return null;
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 px-5 py-4 hover:bg-emerald-500/10 transition group"
    >
      <span className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
        <Radio className="w-5 h-5 animate-pulse" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
          Live sessions
        </p>
        <p className="font-display font-semibold leading-tight mt-0.5">
          {plansPresent ? "Join your live lessons this week" : "See your upcoming live lessons"}
        </p>
      </div>
      <ChevronRight className="w-5 h-5 text-emerald-600 group-hover:translate-x-0.5 transition shrink-0" />
    </Link>
  );
}
