import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createResourceSignedUrl } from "@/lib/storage.functions";
import { DEMO_FILE_PREFIX } from "@/lib/demo/studentDemo";

/**
 * Renders a file stored in the private `resources` bucket as a link that
 * resolves a short-lived signed URL on demand and opens it in a new tab.
 * Shared by the student submission view and the tutor marking queue.
 */
export function SignedFileLink({
  file,
  className,
}: {
  file: { path: string; name: string };
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  // Demo fixtures carry a sentinel path and must not hit real Storage — render
  // them as a static, non-interactive file chip.
  if (file.path.startsWith(DEMO_FILE_PREFIX)) {
    return (
      <span className={className ?? "text-sm inline-flex items-center gap-2 text-muted-foreground"}>
        <FileText className="w-3.5 h-3.5" />
        {file.name}
      </span>
    );
  }

  const open = async () => {
    // The tab must be opened synchronously, while the click's user activation is
    // still live. Awaiting the signed URL first and calling window.open after
    // spends that activation, and the popup blocker then drops the tab silently
    // — no error, no file, work that looks lost.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    setLoading(true);
    try {
      const { url } = await createResourceSignedUrl({ data: { path: file.path } });
      if (tab) tab.location.replace(url);
      // Popups blocked outright: fall back to the current tab rather than
      // failing silently.
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      toast.error(err instanceof Error ? err.message : "Could not open file");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className={
        className ??
        "text-sm inline-flex items-center gap-2 text-primary hover:underline disabled:opacity-60"
      }
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <FileText className="w-3.5 h-3.5" />
      )}
      {file.name}
    </button>
  );
}
