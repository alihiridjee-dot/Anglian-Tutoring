import { useState } from "react";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { CurriculumSyncService, type ParsedCurriculum } from "@/lib/curriculumSyncService";
import { toast } from "sonner";
import {
  RefreshCw,
  CloudLightning,
  FileText,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";

interface CurriculumSyncPanelProps {
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  onSynced: () => void;
}

export function CurriculumSyncPanel({ subject, board, level, onSynced }: CurriculumSyncPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [parsedData, setParsedData] = useState<ParsedCurriculum | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    prod?: "idle" | "syncing" | "success" | "failed";
    demo?: "idle" | "syncing" | "success" | "failed";
    prodError?: string;
    demoError?: string;
  }>({});

  const handleParse = () => {
    if (!rawText.trim()) {
      toast.error("Please paste specification text to parse.");
      return;
    }

    try {
      const parsed = CurriculumSyncService.parseCurriculumText(rawText, subject, board, level);
      setParsedData(parsed);
      toast.success("Successfully parsed curriculum layout structure!");
    } catch (e: unknown) {
      toast.error(`Parsing error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSync = async () => {
    if (!parsedData) return;

    setSyncing(true);
    setSyncStatus({ prod: "syncing", demo: "syncing" });

    try {
      const results = await CurriculumSyncService.uploadCurriculum(parsedData);

      setSyncStatus({
        prod: results.production.success ? "success" : "failed",
        prodError: results.production.error,
        demo: results.demo.success ? "success" : "failed",
        demoError: results.demo.error,
      });

      if (results.production.success && results.demo.success) {
        toast.success("All environments synchronized successfully with strict isolation!");
        setRawText("");
        setParsedData(null);
        setIsOpen(false);
        onSynced();
      } else if (results.production.success || results.demo.success) {
        toast.warning("Partial synchronization completed. Review details.");
        onSynced();
      } else {
        toast.error("Sync failed across both environments.");
      }
    } catch (e: unknown) {
      toast.error(`Sync error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-violet-500/10 text-violet-500">
            <CloudLightning className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm">Curriculum Sync Service</h3>
            <p className="text-xs text-muted-foreground">
              OCR manual OCR/Syllabus PDF importer to Production and isolated Demo spaces.
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="h-9 px-4 rounded-xl border border-border hover:bg-accent text-xs font-medium transition-colors"
        >
          {isOpen ? "Close Sync Service" : "Launch Sync Portal"}
        </button>
      </div>

      {isOpen && (
        <div className="mt-6 border-t border-border pt-5 space-y-5 animate-in fade-in duration-300">
          <div className="grid md:grid-cols-2 gap-5">
            {/* Input Column */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Raw Specification OCR PDF text
              </label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Paste OCR text here. (e.g. 'Topic B1: Cell level systems\nB1.1a describe how light microscopes work...')"
                className="w-full h-44 rounded-xl bg-secondary border border-border p-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono resize-none"
              />
              <button
                onClick={handleParse}
                className="w-full h-9 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Parse Text Specification
              </button>
            </div>

            {/* Preview Column */}
            <div className="rounded-xl bg-secondary/50 border border-border p-4 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                  Live Parsing Blueprint Preview
                </h4>
                {parsedData ? (
                  <div className="space-y-3">
                    <div className="p-2.5 rounded-lg bg-card border border-border">
                      <div className="text-xs font-mono text-primary font-bold">
                        {parsedData.topicCode}
                      </div>
                      <div className="font-medium text-foreground text-xs mt-0.5">
                        {parsedData.topicTitle}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Scope: {parsedData.board.toUpperCase()} • {parsedData.level.toUpperCase()} •{" "}
                        {parsedData.subject.charAt(0).toUpperCase() + parsedData.subject.slice(1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
                        Spec Points Detected ({parsedData.specPoints.length})
                      </div>
                      <div className="max-h-24 overflow-y-auto space-y-1 pr-1">
                        {parsedData.specPoints.map((pt, idx) => (
                          <div
                            key={idx}
                            className="text-[11px] flex items-start gap-1.5 text-foreground leading-relaxed bg-card/40 p-1.5 rounded"
                          >
                            <span className="font-mono text-primary/80 font-bold">{pt.code}</span>
                            <span className="truncate">{pt.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-40 flex flex-col items-center justify-center text-center text-muted-foreground p-4">
                    <FileText className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-[11px]">No blueprint parsed yet.</p>
                    <p className="text-[10px] opacity-70 mt-0.5">
                      Enter raw OCR syllabus copy to process hierarchy.
                    </p>
                  </div>
                )}
              </div>

              {parsedData && (
                <div className="pt-3 border-t border-border/60 mt-3">
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="w-full h-9 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                  >
                    {syncing ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5" />
                    )}
                    Push Dual-Environment Sync
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sync Progress Details */}
          {syncStatus.prod && (
            <div className="rounded-xl bg-violet-500/5 border border-violet-500/10 p-4 space-y-3">
              <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-violet-500" />
                Dual-Environment Synchronization Pipeline
              </div>
              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                {/* Production */}
                <div className="p-3 rounded-lg bg-card border border-border flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Production Database Space</div>
                    <div className="text-[10px] text-muted-foreground">Secure Live Schema</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {syncStatus.prod === "syncing" && (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                    )}
                    <span
                      className={`font-mono text-[10px] font-bold uppercase ${
                        syncStatus.prod === "success"
                          ? "text-emerald-500"
                          : syncStatus.prod === "failed"
                            ? "text-rose-500"
                            : "text-amber-500"
                      }`}
                    >
                      {syncStatus.prod}
                    </span>
                  </div>
                </div>

                {/* Demo */}
                <div className="p-3 rounded-lg bg-card border border-border flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Demo Isolated Space</div>
                    <div className="text-[10px] text-muted-foreground">Separated sandbox</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {syncStatus.demo === "syncing" && (
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                    )}
                    <span
                      className={`font-mono text-[10px] font-bold uppercase ${
                        syncStatus.demo === "success"
                          ? "text-emerald-500"
                          : syncStatus.demo === "failed"
                            ? "text-rose-500"
                            : "text-amber-500"
                      }`}
                    >
                      {syncStatus.demo}
                    </span>
                  </div>
                </div>
              </div>
              {syncStatus.prodError && (
                <div className="text-[10px] text-rose-500 bg-rose-500/5 p-2 rounded border border-rose-500/10">
                  Production Sync Error: {syncStatus.prodError}
                </div>
              )}
              {syncStatus.demoError && (
                <div className="text-[10px] text-rose-500 bg-rose-500/5 p-2 rounded border border-rose-500/10">
                  Demo Sync Error: {syncStatus.demoError}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
