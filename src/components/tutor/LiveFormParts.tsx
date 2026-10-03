import { Smartphone, Loader2, Wand2 } from "lucide-react";
import { type LiveFormState } from "./useLiveForm";

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
        className="shrink-0 min-h-11 sm:pointer-fine:min-h-0 px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/15 text-primary text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-70"
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
      <label className="flex min-h-11 sm:pointer-fine:min-h-0 items-center gap-2 cursor-pointer text-sm">
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
