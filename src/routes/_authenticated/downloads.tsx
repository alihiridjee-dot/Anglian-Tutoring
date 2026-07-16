import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Download as DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { isDemoStudent, DEMO_DOWNLOADS, DEMO_FILE_PREFIX } from "@/lib/demo/studentDemo";

export const Route = createFileRoute("/_authenticated/downloads")({
  head: () => ({ meta: [{ title: "Downloads | StudyHub" }] }),
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
    const { data } = await supabase.storage.from("resources").createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <AppLayout title="Downloads">
      <FilterBar value={filters} onChange={setFilters} />
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <p className="text-muted-foreground">No downloads yet.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((d) => (
            <div
              key={d.id}
              className="rounded-xl bg-card border border-border p-5 flex items-center gap-4"
            >
              <div className="w-11 h-11 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{d.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  <span className="capitalize">{d.subject}</span> · {d.board.toUpperCase()} ·{" "}
                  {d.level === "gcse" ? "GCSE" : "A-Level"}
                  {d.file_size ? ` · ${fmtSize(d.file_size)}` : ""}
                </p>
              </div>
              {d.file_path && (
                <button
                  onClick={() => open(d.file_path!)}
                  className="bg-primary text-primary-foreground px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <DownloadIcon className="w-3.5 h-3.5" />
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
