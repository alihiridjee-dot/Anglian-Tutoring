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
  MessageCircle,
  Palmtree,
  Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/lib/auth/session";
import { BELL_REFRESH } from "@/lib/shell/bellRefresh";
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
 * The title on one line, so what happened fits before the line runs out (and
 * before a score chip). The database writes the long forms: "Eddie Miles
 * acknowledged your feedback" (`acknowledge_submission`) is shown as "Eddie
 * Miles read your feedback", and "Your task has been marked" as "Task marked".
 */
function shortTitle(n: Notification): string {
  if (n.type === "feedback_acknowledged")
    return n.title.replace(/ acknowledged your feedback$/, " read your feedback");
  if (n.type === "homework_marked")
    return n.title.replace(/^Your (task|homework) has been marked$/, "Task marked");
  return n.title;
}

/** The time as a short chip: "Now", "5m", "3h", "2d", "3w", then "6 Oct". */
function shortAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "Now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
  });
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
    // The bell keeps only what hasn't been read: a notice leaves it once read.
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at, chat_thread_id")
      .is("read_at", null)
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

  // Reading a conversation in Messages also marks its notifications read
  // (mark_chat_thread_read), so the badge here follows without a poll.
  useEffect(() => {
    const reload = () => void load();
    window.addEventListener(BELL_REFRESH, reload);
    return () => window.removeEventListener(BELL_REFRESH, reload);
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
    setItems([]);
    await supabase.from("notifications").update({ read_at: now }).in("id", ids);
  };

  // Opening a notification is reading it, so it leaves the bell.
  const openOne = (n: Notification) => {
    setOpen(false);
    if (n.read_at) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    void supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("id", n.id)
      .then(() => undefined);
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
            <ul className="bell-trail">
              {items.map((n, i) => {
                const kind = KIND[n.type] ?? OTHER_KIND;
                const Icon = kind.icon;
                const { text, pct } = splitScore(n.body);
                const unseen = !n.read_at;
                const title = shortTitle(n);
                const body = (
                  <div
                    className={cn("bell-stop", kind.tint)}
                    title={`${n.title}${text ? ` — ${text}` : ""}`}
                  >
                    <span className={cn("icon-tile bell-stop-dot", unseen && "icon-tile-solid")}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-bold leading-snug">{title}</p>
                        {pct != null && (
                          <Chip tint={scoreTint(pct)} className="numeral shrink-0">
                            {pct}%
                          </Chip>
                        )}
                      </div>
                      {text && <p className="truncate text-sm leading-snug">{text}</p>}
                    </div>
                    {/* Unread takes the notice's own colour; read goes quiet. */}
                    <Chip
                      tint={unseen ? undefined : "tint-slate"}
                      className="shrink-0 whitespace-nowrap"
                    >
                      <time dateTime={n.created_at} title={timeAgo(n.created_at)}>
                        {shortAgo(n.created_at)}
                      </time>
                    </Chip>
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
                        onClick={() => openOne(n)}
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
