import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { supabase } from "@/integrations/supabase/client";
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
} from "lucide-react";
import { toast } from "sonner";
import { isDemoStudent, DEMO_LIVE } from "@/lib/demo/studentDemo";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({ meta: [{ title: "Live Sessions | StudyHub" }] }),
  component: Live,
});

interface LiveSession {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  starts_at: string | null;
  join_url: string | null;
  subject: string;
  level: string;
  board: string | null;
}

function Live() {
  const [filters, setFilters] = useState<Filters>({});
  const { data, isLoading } = useQuery({
    queryKey: ["live", filters],
    queryFn: async () => {
      if (isDemoStudent()) {
        return DEMO_LIVE.filter(
          (s) =>
            (!filters.subject || s.subject === filters.subject) &&
            (!filters.board || s.board === filters.board) &&
            (!filters.level || s.level === filters.level),
        );
      }
      let q = supabase
        .from("resources")
        .select("*")
        .eq("kind", "live_session")
        .order("starts_at", { ascending: true });
      if (filters.subject) q = q.eq("subject", filters.subject);
      if (filters.board) q = q.eq("board", filters.board);
      if (filters.level) q = q.eq("level", filters.level);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
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
      <FilterBar value={filters} onChange={setFilters} />
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (data ?? []).length === 0 ? (
        <p className="text-muted-foreground">No sessions scheduled.</p>
      ) : (
        <>
          <h3 className="font-display text-lg font-semibold mb-3">Upcoming</h3>
          <div className="grid gap-3 mb-8">
            {upcoming.length === 0 && (
              <p className="text-sm text-muted-foreground">No upcoming sessions.</p>
            )}
            {upcoming.map((s) => {
              const isTeams = s.join_url?.toLowerCase().includes("teams");
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

                    {/* Conditional join buttons (Teams vs General) */}
                    {s.join_url ? (
                      isTeams ? (
                        <a
                          href={s.join_url}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-[#5B5FC7] hover:bg-[#4B53BC] text-white px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors"
                        >
                          <Video className="w-4 h-4" />
                          Join Teams Meeting
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
                  </div>
                </div>
              );
            })}
          </div>
          {past.length > 0 && (
            <>
              <h3 className="font-display text-lg font-semibold mb-3">Past</h3>
              <div className="grid gap-3">
                {past.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-xl bg-card border border-border p-5 flex items-center gap-4 opacity-70"
                  >
                    <Calendar className="w-5 h-5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground w-48">
                      {new Date(s.starts_at!).toLocaleString()}
                    </p>
                    <p className="flex-1 font-medium">{s.title}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
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
