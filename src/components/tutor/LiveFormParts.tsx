import { Smartphone } from "lucide-react";
import { type LiveFormState } from "./useLiveForm";

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
