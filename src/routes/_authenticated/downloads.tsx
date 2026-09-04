import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Download as DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { isDemoStudent, DEMO_DOWNLOADS, DEMO_FILE_PREFIX } from "@/lib/demo/studentDemo";

export const Route = createFileRoute("/_authenticated/downloads")({
  head: () => ({ meta: [{ title: "Downloads | Anglia Educate" }] }),
  component: Downloads,
});

function fmtSize(n: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function Downloads() {
  const [filters, setFilters] = useState<Filters>({});
  const { data, isLoading } = useQuery({
    queryKey: ["downloads", filters],
    queryFn: async () => {
      if (isDemoStudent()) {
        return DEMO_DOWNLOADS.filter(
          (d) =>
            (!filters.subject || d.subject === filters.subject) &&
            (!filters.board || d.board === filters.board) &&
            (!filters.level || d.level === filters.level),
        );
      }
      let q = supabase
        .from("resources")
        .select("*")
        .eq("kind", "download")
        .order("created_at", { ascending: false });
      if (filters.subject) q = q.eq("subject", filters.subject);
      if (filters.board) q = q.eq("board", filters.board);
      if (filters.level) q = q.eq("level", filters.level);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const open = async (path: string) => {
    // Demo fixtures carry a sentinel path — never hit real Storage.
    if (path.startsWith(DEMO_FILE_PREFIX)) {
      toast.info("Downloads are disabled in the demo sandbox.");
      return;
    }
    // Open the tab BEFORE awaiting the signed URL — awaiting first spends the
    // click's user activation and the popup blocker silently drops the tab.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    const { data, error } = await supabase.storage.from("resources").createSignedUrl(path, 3600);
    if (data?.signedUrl) {
      if (tab) tab.location.replace(data.signedUrl);
      else window.location.href = data.signedUrl;
    } else {
      tab?.close();
      toast.error(error?.message ?? "Could not open that file.");
    }
  };

  return (
    <AppLayout title="Downloads">
      <FilterBar value={filters} onChange={setFilters} />
      {isLoading ? (
        <Spinner label="Fetching your worksheets" />
      ) : !data || data.length === 0 ? (
        <EmptyState
          mascot="books"
          mood="sleepy"
          title="No worksheets here yet"
          body="Nothing has been shared for this subject, board and level yet. Your tutor adds worksheets and past papers as you cover the topics — check back after your next lesson."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((d) => (
            <div key={d.id} className="pop-card flex items-center gap-4 p-5">
              <span className="icon-tile size-11 shrink-0">
                <FileText className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display truncate font-bold">{d.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  <span className="capitalize">{d.subject}</span>
                  {d.board ? ` · ${d.board.toUpperCase()}` : ""} ·{" "}
                  {d.level === "gcse" ? "GCSE" : "A-Level"}
                  {d.file_size ? ` · ${fmtSize(d.file_size)}` : ""}
                </p>
              </div>
              {d.file_path && (
                <button
                  onClick={() => open(d.file_path!)}
                  className="btn-solid inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs"
                >
                  <DownloadIcon className="size-3.5" aria-hidden />
                  Download
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
