import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  Check,
  CheckCheck,
  ClipboardCheck,
  Clock,
  MessageCircle,
  Palmtree,
  Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/lib/auth/session";
import { Chip, EmptyState, ErrorNote } from "@/components/Shared";
import { scoreTint, timeAgo } from "@/components/students/studentPresentation";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  /** The conversation a chat notification is about. */
  chat_thread_id: string | null;
};

/** Each kind of notice wears its own icon and colour, so a glance says which is which. */
const KIND: Record<string, { icon: LucideIcon; tint: string }> = {
  homework_marked: { icon: ClipboardCheck, tint: "tint-primary" },
  feedback_acknowledged: { icon: CheckCheck, tint: "tint-emerald" },
  chat_message: { icon: MessageCircle, tint: "tint-accent" },
  parent_invite: { icon: Users, tint: "tint-pop" },
  break_booked: { icon: Palmtree, tint: "tint-amber" },
};
const OTHER_KIND = { icon: Bell, tint: "tint-slate" };

/**
 * A marked task's body ends " — 33%" (see `notify_when_tutor_publishes`). The
 * score comes off it and is shown as a coloured badge; the rest is the title.
 */
function splitScore(body: string | null): { text: string | null; pct: number | null } {
  const m = body?.match(/^(.*?)\s+—\s+(\d{1,3})%$/);
  return m ? { text: m[1], pct: Number(m[2]) } : { text: body, pct: null };
}

/**
 * Header bell showing this user's notifications.
 *
 * RLS ("notifications read own") scopes the query to the caller, so there's no
 * recipient filter here — the database decides what's visible. Currently the
 * only producer is `acknowledge_submission`, which tells a tutor their feedback
 * was read, but nothing here is homework-specific.
 */
export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  // A failed read is not "You're all caught up". The last good list is kept
  // and the panel says the read failed, with a retry.
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // How far the panel slides right of the bell. On a phone the header wraps and
  // the bell sits near the left edge, so a panel hung from its right edge would
  // run off the screen; this keeps it 1rem (the header's gutter) inside.
  const [shift, setShift] = useState(0);

  const load = useCallback(async () => {
    // The demo platform is a self-contained showcase — never read real rows.
    if (isDemoMode()) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at, chat_thread_id")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      setLoadError(new Error(error.message));
      return;
    }
    setLoadError(null);
    setItems((data ?? []) as Notification[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Close on outside click so the panel doesn't trap the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!ref.current || !panelRef.current) return;
      const left = ref.current.getBoundingClientRect().right - panelRef.current.offsetWidth;
      setShift(Math.max(0, 16 - left));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const unread = items.filter((n) => !n.read_at).length;

  const markAllRead = async () => {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabase.from("notifications").update({ read_at: now }).in("id", ids);
  };

  if (isDemoMode()) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="relative size-11 sm:pointer-fine:size-9 rounded-lg border border-border hover:bg-muted flex items-center justify-center cursor-pointer"
      >
        <Bell className={cn("w-4 h-4", unread > 0 && "bell-ring")} />
        {unread > 0 && (
          <span className="chip chip-solid tint-rose pop-in absolute -top-1.5 -right-1.5 min-w-5 h-5 justify-center px-1 text-[10px]">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          style={{ right: -shift }}
          className="tint-primary pop-in absolute top-12 sm:top-11 w-[min(22rem,calc(100vw-2rem))] max-h-[min(28rem,70dvh)] overflow-auto rounded-2xl premium-card shadow-xl z-50"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border sticky top-0 z-10 bg-card">
            <div className="flex items-center gap-2">
              <span className="icon-tile size-8">
                <Bell className="size-4" aria-hidden />
              </span>
              <h3 className="text-base font-bold">Notifications</h3>
              {unread > 0 && <Chip tint="tint-primary">{unread} new</Chip>}
            </div>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="btn-soft rounded-full inline-flex min-h-11 sm:pointer-fine:min-h-0 items-center gap-1 px-2.5 py-1 text-xs font-bold cursor-pointer"
              >
                <Check className="size-3.5" aria-hidden /> All read
              </button>
            )}
          </div>

          {loadError && (
            <div className="p-3">
              <ErrorNote error={loadError} onRetry={() => void load()} />
            </div>
          )}
          {items.length === 0 ? (
            !loadError && (
              <div className="p-3">
                <EmptyState title="You're all caught up" mascot="owl" mood="happy" />
              </div>
            )
          ) : (
            <ul className="space-y-2 p-2.5">
              {items.map((n, i) => {
                const kind = KIND[n.type] ?? OTHER_KIND;
                const Icon = kind.icon;
                const { text, pct } = splitScore(n.body);
                const unseen = !n.read_at;
                const body = (
                  <div
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-transform hover:-translate-y-0.5",
                      kind.tint,
                      unseen
                        ? "border-[color-mix(in_oklab,var(--tint)_20%,transparent)] bg-[color-mix(in_oklab,var(--tint)_6%,var(--card))]"
                        : "border-border bg-card",
                    )}
                  >
                    <span className="icon-tile size-10 shrink-0">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-snug">{n.title}</p>
                      {text && <p className="text-sm leading-snug mt-0.5 line-clamp-2">{text}</p>}
                      <Chip icon={Clock} tint="tint-slate" className="mt-1.5">
                        {timeAgo(n.created_at)}
                      </Chip>
                    </div>
                    {pct != null && (
                      <span
                        className={cn(
                          "numeral icon-tile h-10 min-w-12 shrink-0 justify-center px-2 text-base",
                          scoreTint(pct),
                        )}
                      >
                        {pct}%
                      </span>
                    )}
                  </div>
                );
                return (
                  <li
                    key={n.id}
                    className="rise-in"
                    style={{ "--rise-delay": `${Math.min(i, 8) * 0.04}s` } as CSSProperties}
                  >
                    {n.link ? (
                      <Link
                        to={n.link}
                        // A tutor's reply to a parent opens that conversation,
                        // on the child it is about, not just the Portal's top.
                        search={
                          n.link === "/parent-dashboard" && n.chat_thread_id
                            ? { thread: n.chat_thread_id }
                            : undefined
                        }
                        onClick={() => setOpen(false)}
                        className="block"
                      >
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
