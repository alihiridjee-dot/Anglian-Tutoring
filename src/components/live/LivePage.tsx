import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Video } from "lucide-react";
import { EmptyState, ErrorNote, Spinner } from "@/components/Shared";
import { Sparkles, Squiggle } from "@/components/Doodles";
import { useNow } from "@/hooks/useNow";
import { AppLayout } from "@/components/AppLayout";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { useRoles } from "@/hooks/useRole";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useActiveSubject } from "@/hooks/useActiveSubject";
import { subjectLabel } from "@/lib/curriculum/subjectTheme";
import { LiveForm } from "@/components/tutor/LiveForm";
import { NextSessionCountdown } from "@/components/live/NextSessionCountdown";
import {
  fetchLiveSessions,
  hasSessionFinished,
  sessionStartMs,
  sessionsOnCourse,
} from "@/lib/live/liveSessions";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import {
  LiveTabs,
  PastSessionCard,
  UpcomingSessionCard,
  type LiveTab,
} from "@/components/live/LiveSessionCards";
import { WhatsAppReminderModal } from "@/components/live/WhatsAppReminderModal";
import { useWhatsAppReminder } from "@/components/live/useWhatsAppReminder";
import { useDeleteLiveSession } from "@/components/live/useDeleteLiveSession";

export function Live() {
  const { isTutor, userId } = useRoles();
  const course = useEnrolments();
  const { subject: activeSubject } = useActiveSubject();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>({});
  const [tab, setTab] = useState<LiveTab>("upcoming");
  const { deletingId, handleDelete } = useDeleteLiveSession(qc);
  const [subject, setSubject] = useState<SubjectV>("biology");
  const [board, setBoard] = useState<BoardV>("edexcel");
  const [level, setLevel] = useState<LevelV>("gcse");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["live", filters],
    queryFn: () => fetchLiveSessions(filters),
  });

  const {
    selectedSession,
    isReminderOpen,
    closeWhatsAppModal,
    openWhatsAppModal,
    phonePrefix,
    setPhonePrefix,
    phoneNumber,
    setPhoneNumber,
  } = useWhatsAppReminder();

  // A lesson stays under Upcoming — with its Join button — until it has
  // finished, by the same rule the header and the countdown use. This compared
  // against the start time, so a lesson moved to Previous as "Completed" the
  // second it began: a student two minutes late, or a tutor (who gets no
  // countdown above), found the session they were joining filed as over.
  // Ticking, so the lists re-sort as lessons start and end on an open page.
  const now = useNow(30_000);
  // A student's list is their own course: row-level security scopes sessions by
  // subject only, which put every level's lessons in front of them. The header,
  // the banner and the countdown apply the same rule. Then the header slider's
  // subject, as on every student page (only the header's Join button looks
  // across subjects).
  const courseLoading = !isTutor && course.loading;
  const sessions = isTutor
    ? data
    : data && !courseLoading
      ? sessionsOnCourse(data, course).filter((s) => !activeSubject || s.subject === activeSubject)
      : [];
  const dated = (sessions ?? []).filter((s) => sessionStartMs(s) !== null);
  const upcoming = dated.filter((s) => !hasSessionFinished(s, now));
  const past = dated.filter((s) => hasSessionFinished(s, now));

  return (
    <AppLayout title="Live Sessions">
      {isTutor && userId && (
        <div className="max-w-2xl rounded-2xl premium-card p-4 sm:p-6 mb-8">
          <h3 className="font-display text-lg font-bold mb-4">Schedule a Live Session</h3>
          <LiveForm
            userId={userId}
            taxonomy={{ subject, setSubject, board, setBoard, level, setLevel }}
          />
        </div>
      )}

      {/* Students get a live countdown to their next session up top. */}
      {!isTutor && <NextSessionCountdown subject={activeSubject} />}

      {/* Tutors see every session across every subject, so they keep the
          filter. A student's list is already scoped to their own course, and
          a subject/board/level picker would frame these as classes run for
          everyone — so they get a heading instead. */}
      {isTutor ? (
        <FilterBar value={filters} onChange={setFilters} />
      ) : (
        <div className="mb-6 flex items-center gap-3">
          <span className="icon-tile size-10 shrink-0 sm:size-11">
            <Video className="size-5 sm:size-6" aria-hidden />
          </span>
          <h2 className="text-xl font-extrabold sm:text-2xl">
            Live sessions, delivered{" "}
            <span className="relative inline-block whitespace-nowrap">
              for you
              <Squiggle className="absolute -bottom-2 left-0" />
            </span>
            <Sparkles className="ml-1.5 inline-block size-6 -translate-y-2" />
          </h2>
        </div>
      )}

      {/* Upcoming / Previous tab switch */}
      <LiveTabs
        tab={tab}
        onSelect={setTab}
        upcomingCount={upcoming.length}
        pastCount={past.length}
      />

      {isLoading || courseLoading ? (
        <Spinner label="Checking the timetable" />
      ) : error ? (
        // Not the empty state: "No lessons booked in" is a claim about the
        // timetable, and a failed request hasn't read it.
        <ErrorNote error={error} onRetry={() => void refetch()} />
      ) : tab === "upcoming" ? (
        <div data-guide="live-list" className="grid gap-3">
          {upcoming.length === 0 ? (
            <EmptyState
              mascot="owl"
              mood="sleepy"
              title={
                !isTutor && activeSubject
                  ? `No ${subjectLabel(activeSubject)} lessons booked in`
                  : "No lessons booked in"
              }
              body="There's nothing on the timetable right now. Once your tutor schedules the next session it appears here with a join link and the spec points it'll cover."
            />
          ) : (
            upcoming.map((s) => (
              <UpcomingSessionCard
                key={s.id}
                s={s}
                now={now}
                isTutor={isTutor}
                deletingId={deletingId}
                onRemind={openWhatsAppModal}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      ) : (
        // Previous sessions — a lightweight history footnote. Sessions are
        // auto-removed 7 days after they run (server-side pg_cron purge), so
        // this only ever shows the last week.
        <div className="grid gap-3">
          <p className="text-xs text-muted-foreground -mt-1 mb-1">
            A record of recent sessions and what they covered. Automatically cleared 7 days after
            each session.
          </p>
          {past.length === 0 ? (
            <p className="text-muted-foreground text-sm">No sessions in the last 7 days.</p>
          ) : (
            past.map((s) => (
              <PastSessionCard
                key={s.id}
                s={s}
                isTutor={isTutor}
                deletingId={deletingId}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      )}

      {/* WhatsApp Modal Dialog */}
      {isReminderOpen && selectedSession && (
        <WhatsAppReminderModal
          selectedSession={selectedSession}
          onClose={closeWhatsAppModal}
          phonePrefix={phonePrefix}
          setPhonePrefix={setPhonePrefix}
          phoneNumber={phoneNumber}
          setPhoneNumber={setPhoneNumber}
        />
      )}
    </AppLayout>
  );
}
