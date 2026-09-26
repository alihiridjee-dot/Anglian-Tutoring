import { type LiveSession } from "@/lib/live/liveSessions";
import { whatsAppGroupShareLink, whatsAppShareLink } from "@/lib/live/whatsappShare";
import { Smartphone, X, Send, Share2, Info } from "lucide-react";
import { toast } from "sonner";
import { useEffect } from "react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

export function WhatsAppReminderModal({
  selectedSession,
  onClose,
  phonePrefix,
  setPhonePrefix,
  phoneNumber,
  setPhoneNumber,
}: {
  selectedSession: LiveSession;
  onClose: () => void;
  phonePrefix: string;
  setPhonePrefix: (prefix: string) => void;
  phoneNumber: string;
  setPhoneNumber: (number: string) => void;
}) {
  // Holds the page still underneath; Escape or a tap outside closes it. The
  // number lives in the parent's state, so closing loses nothing.
  useBodyScrollLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsapp-reminder-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-border flex flex-col">
        {/* Header banner */}
        <div className="bg-[#25D366] text-white p-4 sm:p-6 relative">
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap-target absolute top-4 right-4 text-white/80 hover:text-white p-1 rounded-full hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 shrink-0 rounded-full bg-white/10 flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0 pr-8">
              <h3
                id="whatsapp-reminder-title"
                className="font-display font-bold text-lg leading-tight"
              >
                WhatsApp Live Session Alerts
              </h3>
              <p className="text-white/85 text-xs mt-0.5">For "{selectedSession.title}"</p>
            </div>
          </div>
        </div>

        {/* Modal Body — WhatsApp share only. There is no automated-reminder
            backend, so nothing here pretends to register one: both actions
            open a real wa.me chat with the session details pre-filled. */}
        <div className="p-4 sm:p-6 space-y-5">
          <p className="text-sm text-muted-foreground">
            Send yourself the session details on WhatsApp, or share the invite with your study
            group.
          </p>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Your phone number (for "Send to Myself")
            </label>
            <div className="flex gap-2">
              <select
                aria-label="Country code"
                className="w-24 h-11 sm:h-10 px-2 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-hidden"
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
                type="tel"
                autoComplete="tel-national"
                aria-label="Your phone number"
                placeholder="7123 456789"
                className="min-w-0 flex-1 h-11 sm:h-10 px-3 bg-white border border-border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-hidden"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9\s]/g, ""))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a
              href={whatsAppShareLink(selectedSession, phonePrefix, phoneNumber)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (!phoneNumber) {
                  e.preventDefault();
                  toast.error("Enter your phone number first.");
                }
              }}
              className="h-11 sm:h-10 bg-[#25D366] hover:bg-[#20ba59] text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition text-center"
            >
              <Send className="w-3.5 h-3.5" />
              Send to Myself
            </a>
            <a
              href={whatsAppGroupShareLink(selectedSession)}
              target="_blank"
              rel="noreferrer"
              className="h-11 sm:h-10 border border-border hover:bg-secondary text-foreground font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition text-center"
            >
              <Share2 className="w-3.5 h-3.5 text-muted-foreground" />
              Share Invite Link
            </a>
          </div>
        </div>

        <div className="bg-[#f8f9fa] border-t border-border p-4 text-[11px] text-muted-foreground flex gap-2">
          <Info className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span>
            Your number never leaves this page — it's only used to open your own WhatsApp chat.
          </span>
        </div>
      </div>
    </div>
  );
}
