import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { toast } from "sonner";
import {
  PlayCircle,
  CalendarClock,
  ClipboardList,
  Upload,
  Wrench,
  ClipboardCheck,
} from "lucide-react";

import { VideoForm } from "@/components/tutor/VideoForm";
import { LiveForm } from "@/components/tutor/LiveForm";
import { HomeworkForm } from "@/components/tutor/HomeworkForm";
import { DownloadForm } from "@/components/tutor/DownloadForm";
import { MarkingQueue } from "@/components/tutor/MarkingQueue";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

export const Route = createFileRoute("/_authenticated/tutor")({
  head: () => ({ meta: [{ title: "Tutor Studio | StudyHub" }] }),
  component: Tutor,
});

type Kind = "video" | "live_session" | "homework" | "download";
type Tab = "marking" | Kind;

function useTaxonomy() {
  const [subject, setSubject] = useState<SubjectV>("biology");
  const [board, setBoard] = useState<BoardV>("edexcel");
  const [level, setLevel] = useState<LevelV>("gcse");
  return { subject, board, level, setSubject, setBoard, setLevel };
}

function Tutor() {
  const { isTutor, loading, userId, email } = useRoles();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("marking");
  const taxonomy = useTaxonomy();

  // Access is a tutor/admin privilege.
  useEffect(() => {
    if (!loading && !isTutor) {
      toast.error("Tutor access required");
      navigate({ to: "/dashboard" });
    }
  }, [loading, isTutor, navigate]);

  if (!isTutor) return <AppLayout title="Tutor Studio">Loading…</AppLayout>;

  const tutorName = email ? email.split("@")[0] : "Tutor";

  const tabs: { k: Tab; label: string; icon: typeof PlayCircle }[] = [
    { k: "marking", label: "Marking Queue", icon: ClipboardCheck },
    { k: "video", label: "Add Video", icon: PlayCircle },
    { k: "live_session", label: "Schedule Live", icon: CalendarClock },
    { k: "homework", label: "Set Homework", icon: ClipboardList },
    { k: "download", label: "Upload File", icon: Upload },
  ];

  return (
    <AppLayout title="Tutor Studio">
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-8 mb-6 relative overflow-hidden border border-slate-800 shadow-sm">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "radial-gradient(circle at 30% 20%, white 1.5px, transparent 1.5px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <Wrench className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="text-xs uppercase tracking-widest text-slate-300 font-semibold">
              Tutor Workspace
            </span>
          </div>
          <h2 className="font-display text-3xl font-bold tracking-tight text-white capitalize">
            Welcome, {tutorName}
          </h2>
          <p className="text-sm md:text-base text-slate-300 max-w-2xl mt-1">
            Mark student submissions and manage teaching resources — set homework, upload files and
            videos, and schedule live sessions.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition ${
              tab === t.k
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "marking" ? (
        <MarkingQueue />
      ) : (
        <div className="max-w-2xl rounded-2xl bg-card border border-border p-6">
          {tab === "video" && <VideoForm userId={userId!} taxonomy={taxonomy} />}
          {tab === "live_session" && <LiveForm userId={userId!} taxonomy={taxonomy} />}
          {tab === "homework" && <HomeworkForm userId={userId!} taxonomy={taxonomy} />}
          {tab === "download" && <DownloadForm userId={userId!} taxonomy={taxonomy} />}
        </div>
      )}
    </AppLayout>
  );
}
