import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/AppLayout";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { LiveForm } from "@/components/tutor/LiveForm";
import { NextSessionCountdown } from "@/components/live/NextSessionCountdown";
import { deleteZoomMeeting } from "@/lib/zoom.functions";
import { generateWeeklyQuiz } from "@/lib/mcq.functions";
import { fetchLiveSessions, type LiveSession } from "@/lib/liveSessions";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import {
  Video,
  Calendar,
  Smartphone,
  X,
  Send,
  CheckCircle2,
  Share2,
  Info,
  Loader2,
  Trash2,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({ meta: [{ title: "Live Sessions | StudyHub" }] }),
  component: Live,
});

export function Live() {
  const { isTutor, userId } = useRoles();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>({});
  const [tab, setTab] = useState<"upcoming" | "previous">("upcoming");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [quizGenId, setQuizGenId] = useState<string | null>(null);
  const genQuiz = useServerFn(generateWeeklyQuiz);
  const [subject, setSubject] = useState<SubjectV>("biology");
  const [board, setBoard] = useState<BoardV>("edexcel");
  const [level, setLevel] = useState<LevelV>("gcse");
  const { data, isLoading } = useQuery({
    queryKey: ["live", filters],
    queryFn: () => fetchLiveSessions(filters),
  });

  // WhatsApp Alert Modal state
  const [selectedSession, setSelectedSession] = useState<LiveSession | null>(null);
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  const [phonePrefix, setPhonePrefix] = useState("+44");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const now = Date.now();
  const upcoming = ((data as LiveSession[]) ?? []).filter(
    (s) => s.starts_at && new Date(s.starts_at).getTime() >= now,
  );
  const past = ((data as LiveSession[]) ?? []).filter(
    (s) => s.starts_at && new Date(s.starts_at).getTime() < now,
  );

  // Tutor-only: cancel a session scheduled in error. Removes the Zoom meeting
  // first (best-effort — a link-less or already-gone meeting is fine), then
  // deletes the resource row. The row delete is the RLS-checked, authoritative
  // step and cascades to resource_spec_points / session_attendees, so the
  // session vanishes everywhere (including any curriculum point it was on).
  const handleDelete = async (session: LiveSession) => {
    if (!confirm(`Delete "${session.title}"? This removes the session and its Zoom meeting for everyone.`))
      return;
    setDeletingId(session.id);
    try {
      if (session.join_url?.toLowerCase().includes("zoom")) {
        try {
          await deleteZoomMeeting(session.join_url);
        } catch (err) {
          // Don't block removing the row if Zoom cancellation fails — surface it
          // but still delete locally so a bad session can always be cleared.
          toast.warning(
            err instanceof Error ? `Zoom meeting not cancelled: ${err.message}` : "Zoom meeting not cancelled.",
          );
        }
      }
      const { error } = await supabase.from("resources").delete().eq("id", session.id);
      if (error) throw error;
      toast.success("Session deleted");
      qc.invalidateQueries({ queryKey: ["live"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete session");
    } finally {
      setDeletingId(null);
    }
  };

  // Tutor-only manual trigger: (re)generate the auto-published weekly quiz for
  // a session. Same server fn that fires automatically on session creation —
  // used here as a top-up when spec points changed or the first run failed.
  const handleGenerateQuiz = async (session: LiveSession) => {
    if (session.specPoints.length === 0) {
      toast.error("Tag at least one spec point on this session first.");
      return;
    }
    setQuizGenId(session.id);
    try {
      const res = await genQuiz({ data: { resourceId: session.id } });
      toast.success(`Weekly quiz published — ${res.count} questions`);
      qc.invalidateQueries({ queryKey: ["mcqs"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Quiz generation failed");
    } finally {
      setQuizGenId(null);
    }
  };

  const openWhatsAppModal = (session: LiveSession) => {
    setSelectedSession(session);
    setIsReminderOpen(true);
    setPhoneNumber("");
    setIsSubscribed(false);
    setIsSubscribing(false);
  };

  const getWhatsAppShareLink = (s: LiveSession) => {
    const timeStr = s.starts_at ? new Date(s.starts_at).toLocaleString() : "";
    const text = `📚 *StudyHub Live Session Reminder* 📚\n\nI have an upcoming live session scheduled:\n\n🔹 *Session:* ${s.title}\n🔹 *Subject:* ${s.subject.toUpperCase()} (${s.level.toUpperCase()})\n🔹 *Time:* ${timeStr}\n\n👉 *Join link:* ${s.join_url || "Link pending"}\n\nSee you there!`;
    const cleanPhone = `${phonePrefix.replace("+", "")}${phoneNumber.replace(/[^0-9]/g, "")}`;
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  };

  const getWhatsAppGroupShareLink = (s: LiveSession) => {
    const timeStr = s.starts_at ? new Date(s.starts_at).toLocaleString() : "";
    const text = `📚 *StudyHub Live Session Invite* 📚\n\nHey everyone! Join the live tutoring session:\n\n🔹 *Session:* ${s.title}\n🔹 *Subject:* ${s.subject.toUpperCase()} (${s.level.toUpperCase()})\n🔹 *Time:* ${timeStr}\n\n👉 *Join here:* ${s.join_url || "Link pending"}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  const handleSubscribeAlerts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) {
      toast.error("Please enter a phone number.");
      return;
    }
    setIsSubscribing(true);
    // Simulate Broadcast alert API signup
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsSubscribing(false);
    setIsSubscribed(true);
    toast.success("Registered for WhatsApp notifications!");
  };

  return (
    <AppLayout title="Live Sessions">
      {isTutor && userId && (
        <div className="max-w-2xl rounded-2xl bg-card border border-border p-6 mb-8">
          <h3 className="font-display text-lg font-semibold mb-4">Schedule a Live Session</h3>
          <LiveForm
            userId={userId}
            taxonomy={{ subject, setSubject, board, setBoard, level, setLevel }}
          />
        </div>
      )}

      {/* Students get a live countdown to their next session up top. */}
      {!isTutor && <NextSessionCountdown />}

      <FilterBar value={filters} onChange={setFilters} />

      {/* Upcoming / Previous tab switch */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary/60 border border-border w-fit mb-5">
        {(["upcoming", "previous"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition ${
              tab === t
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
            <span className="ml-1.5 text-xs text-muted-foreground">
              {t === "upcoming" ? upcoming.length : past.length}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : tab === "upcoming" ? (
        <div className="grid gap-3">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming sessions.</p>
          ) : (
            upcoming.map((s) => {
              const isZoom = s.join_url?.toLowerCase().includes("zoom");
              return (
                <div
                  key={s.id}
                  className="rounded-xl bg-card border border-border p-5 flex flex-col lg:flex-row lg:items-center gap-4"
                >
                  <div className="flex items-center gap-3 lg:w-64">
                    <div className="w-11 h-11 rounded-lg bg-secondary flex items-center justify-center">
                      <Calendar className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(s.starts_at!).toLocaleString()}
                      </p>
                      <p className="font-medium capitalize">
                        {s.subject} · {s.level}
                      </p>
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{s.title}</p>
                    {s.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {s.description}
                      </p>
                    )}
                    <WhatsCovered points={s.specPoints} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* WhatsApp Reminder Button */}
                    <button
                      onClick={() => openWhatsAppModal(s)}
                      className="border border-[#25D366]/40 hover:border-[#25D366] text-[#128C7E] hover:bg-[#25D366]/5 px-3.5 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Smartphone className="w-4 h-4 text-[#25D366]" />
                      Remind on WhatsApp
                    </button>

                    {/* Conditional join buttons (Zoom vs General) */}
                    {s.join_url ? (
                      isZoom ? (
                        <a
                          href={s.join_url}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-[#2D8CFF] hover:bg-[#2681F2] text-white px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors"
                        >
                          <Video className="w-4 h-4" />
                          Join Zoom Meeting
                        </a>
                      ) : (
                        <a
                          href={s.join_url}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors"
                        >
                          <Video className="w-4 h-4" />
                          Join Session
                        </a>
                      )
                    ) : null}

                    {isTutor && s.specPoints.length > 0 && (
                      <button
                        onClick={() => handleGenerateQuiz(s)}
                        disabled={quizGenId === s.id}
                        className="border border-accent/40 hover:border-accent text-accent-foreground hover:bg-accent/10 px-3 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
                        title="Generate or refresh this week's MCQ quiz from the tagged spec points"
                      >
                        {quizGenId === s.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                        {quizGenId === s.id ? "Generating…" : "Weekly quiz"}
                      </button>
                    )}

                    {isTutor && (
                      <button
                        onClick={() => handleDelete(s)}
                        disabled={deletingId === s.id}
                        className="border border-destructive/40 hover:border-destructive text-destructive hover:bg-destructive/5 px-3 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
                        title="Delete session and cancel its Zoom meeting"
                      >
                        {deletingId === s.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        // Previous sessions — a lightweight history footnote. Sessions are
        // auto-removed 7 days after they run (server-side pg_cron purge), so
        // this only ever shows the last week.
        <div className="grid gap-3">
          <p className="text-xs text-muted-foreground -mt-1 mb-1">
            A record of recent sessions and what they covered. Automatically cleared 7 days after
            each session.
          </p>
          {past.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions in the last 7 days.</p>
          ) : (
            past.map((s) => (
              <div
                key={s.id}
                className="rounded-xl bg-card border border-border p-5 flex flex-col sm:flex-row sm:items-start gap-3"
              >
                <div className="flex items-center gap-3 sm:w-56 shrink-0">
                  <Calendar className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(s.starts_at!).toLocaleString()}
                    </p>
                    <p className="text-xs font-medium capitalize text-muted-foreground">
                      {s.subject} · {s.level}
                    </p>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{s.title}</p>
                  <WhatsCovered points={s.specPoints} label="Covered" />
                  {s.specPoints.length === 0 && !s.description && (
                    <p className="text-xs text-muted-foreground italic mt-1">
                      No curriculum points recorded.
                    </p>
                  )}
                </div>
                {isTutor && (
                  <button
                    onClick={() => handleDelete(s)}
                    disabled={deletingId === s.id}
                    className="text-muted-foreground hover:text-destructive p-1.5 shrink-0 disabled:opacity-60"
                    title="Delete session now"
                    aria-label={`Delete ${s.title}`}
                  >
                    {deletingId === s.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* WhatsApp Modal Dialog */}
      {isReminderOpen && selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
          <div className="relative w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-2xl border border-border flex flex-col">
            {/* Header banner */}
            <div className="bg-[#25D366] text-white p-6 relative">
              <button
                onClick={() => setIsReminderOpen(false)}
                className="absolute top-4 right-4 text-white/80 hover:text-white p-1 rounded-full hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <Smartphone className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg leading-tight">
                    WhatsApp Live Session Alerts
                  </h3>
                  <p className="text-white/85 text-xs mt-0.5">For "{selectedSession.title}"</p>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {!isSubscribed ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Get an instant schedule summary or register to receive automated reminders
                    before this session goes live.
                  </p>

                  <form onSubmit={handleSubscribeAlerts} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                        Enter Phone Number
                      </label>
                      <div className="flex gap-2">
                        <select
                          className="w-24 h-10 px-2 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-hidden"
                          value={phonePrefix}
                          onChange={(e) => setPhonePrefix(e.target.value)}
                        >
                          <option value="+44">🇬🇧 +44</option>
                          <option value="+1">🇺🇸 +1</option>
                          <option value="+91">🇮🇳 +91</option>
                          <option value="+61">🇦🇺 +61</option>
                          <option value="+33">🇫🇷 +33</option>
                        </select>
                        <input
                          required
                          type="tel"
                          placeholder="7123 456789"
                          className="flex-1 h-10 px-3 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-hidden"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9\s]/g, ""))}
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubscribing}
                      className="w-full h-10 bg-[#25D366] hover:bg-[#20ba59] text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-70"
                    >
                      {isSubscribing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Subscribing…
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Enable Automated Reminders
                        </>
                      )}
                    </button>
                  </form>

                  <div className="border-t border-border pt-5 space-y-3">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                      Quick Manual Actions
                    </span>

                    <div className="grid grid-cols-2 gap-2">
                      <a
                        href={getWhatsAppShareLink(selectedSession)}
                        target="_blank"
                        rel="noreferrer"
                        className="h-10 border border-[#25D366] hover:bg-[#25D366]/5 text-[#128C7E] font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition text-center"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Send to Myself
                      </a>
                      <a
                        href={getWhatsAppGroupShareLink(selectedSession)}
                        target="_blank"
                        rel="noreferrer"
                        className="h-10 border border-border hover:bg-secondary text-foreground font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition text-center"
                      >
                        <Share2 className="w-3.5 h-3.5 text-muted-foreground" />
                        Share Invite Link
                      </a>
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-6 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-xs">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="font-display font-bold text-lg text-foreground">
                      Alert Activated!
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                      Automated broadcasts have been enabled for **{phonePrefix} {phoneNumber}**. We
                      will ping you 15 minutes before the session starts.
                    </p>
                  </div>
                  <div className="flex gap-2 w-full pt-2">
                    <button
                      onClick={() => setIsReminderOpen(false)}
                      className="flex-1 h-10 bg-secondary text-foreground hover:bg-muted font-semibold rounded-lg text-sm transition cursor-pointer"
                    >
                      Done
                    </button>
                    <a
                      href={getWhatsAppShareLink(selectedSession)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 h-10 bg-[#25D366] hover:bg-[#20ba59] text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-1.5 transition text-center"
                    >
                      <Send className="w-4 h-4" />
                      Open Chat Info
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-[#f8f9fa] border-t border-border p-4 text-[11px] text-muted-foreground flex gap-2">
              <Info className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span>
                We value your privacy. Your number is only used to send session updates and will
                never be shared with third parties. UK mobile formats are supported.
              </span>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

// "What's covered" — the curriculum spec points a session is linked to. Same
// data that surfaces the session on each curriculum point's page, shown back on
// the session itself so students know the syllabus scope at a glance.
function WhatsCovered({
  points,
  label = "What's covered",
}: {
  points: LiveSession["specPoints"];
  label?: string;
}) {
  if (points.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <BookOpen className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {points.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-secondary border border-border"
          >
            <span className="font-mono font-medium text-primary">{p.code}</span>
            <span className="text-muted-foreground truncate max-w-[220px]">{p.title}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
