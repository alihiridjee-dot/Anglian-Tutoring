import { Smartphone, Loader2, CalendarRange, Link2, Wand2 } from "lucide-react";
import { type LiveFormState } from "./useLiveForm";

/** Dashboard mode, once a date is picked: which week the session joins, and what that week is about. */
export function WeekLinkBanner({
  weekLoading,
  weekFocus,
  weekLabel,
}: Pick<LiveFormState, "weekLoading" | "weekFocus" | "weekLabel">) {
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-3.5 flex items-start gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
        <CalendarRange className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0 text-xs leading-relaxed">
        {weekLoading ? (
          <p className="text-muted-foreground">Checking this week's focus…</p>
        ) : weekFocus && weekFocus.points.length > 0 ? (
          <p>
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <Link2 className="w-3.5 h-3.5 text-primary" />
              Linked to the week of {weekLabel}
            </span>{" "}
            — {weekFocus.points.length} focus point
            {weekFocus.points.length === 1 ? "" : "s"} added below. Add more if the session covers
            extra ground.
          </p>
        ) : (
          <p className="text-muted-foreground">
            No focus set for the week of{" "}
            <span className="font-medium text-foreground">{weekLabel}</span> yet. Set it in{" "}
            <span className="font-medium text-foreground">This Week</span> above and it will link
            here automatically, or pick points below.
          </p>
        )}
      </div>
    </div>
  );
}

export function AiSuggestRow({
  suggesting,
  suggestFromDescription,
}: Pick<LiveFormState, "suggesting" | "suggestFromDescription">) {
  return (
    <div className="flex items-center justify-between gap-2 -mb-1">
      <p className="text-xs text-muted-foreground">
        Tag the curriculum this session covers, or let AI suggest it from the description.
      </p>
      <button
        type="button"
        onClick={suggestFromDescription}
        disabled={suggesting}
        className="shrink-0 px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/15 text-primary text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-70"
        title="Suggest spec points with AI from the title & description"
      >
        {suggesting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Wand2 className="w-3.5 h-3.5" />
        )}
        {suggesting ? "Suggesting…" : "AI suggest"}
      </button>
    </div>
  );
}

export function BroadcastToggle({
  broadcastWhatsApp,
  setBroadcastWhatsApp,
}: Pick<LiveFormState, "broadcastWhatsApp" | "setBroadcastWhatsApp">) {
  return (
    <div className="p-3 bg-secondary/50 rounded-lg border border-border space-y-2">
      <div className="flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-[#25D366]" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Broadcast Notifications
        </span>
      </div>
      <label className="flex items-center gap-2 cursor-pointer text-sm">
        <input
          type="checkbox"
          className="rounded border-border text-[#25D366] focus:ring-[#25D366]"
          checked={broadcastWhatsApp}
          onChange={(e) => setBroadcastWhatsApp(e.target.checked)}
        />
        <span>Copy formatted group broadcast invite template on schedule</span>
      </label>
    </div>
  );
}
