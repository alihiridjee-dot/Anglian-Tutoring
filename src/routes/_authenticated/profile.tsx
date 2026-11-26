import { createFileRoute } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Loader2, Trash2, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { AbovePage, ErrorNote, Ring, Spinner } from "@/components/Shared";
import { Squiggle } from "@/components/chat/EmptyInbox";
import { TINT_TEXT } from "@/components/planner/workbench/figures";
import { ChoiceTile } from "@/components/onboarding/StepCard";
import { QuestionLoadPicker } from "@/components/practice/QuestionLoadPicker";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { questionLoadKey, useQuestionLoad } from "@/hooks/data/useQuestionLoad";
import { useRoles } from "@/hooks/useRole";
import { useViewerId } from "@/hooks/useViewer";
import { getSessionUserId } from "@/lib/auth/session";
import { examYearOptions } from "@/lib/auth/onboarding";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { type BoardV, type SubjectV } from "@/lib/curriculum/taxonomy";
import { ProgramDAL } from "@/lib/planner/programDal";
import { examMondayIn } from "@/lib/planner/pacing";
import { invalidatePlanner } from "@/lib/planner/queries";
import { currentWeekKey } from "@/lib/planner/week";
import { dbError } from "@/lib/platform/errors";
import {
  HEAVIEST_LIVE_LOAD,
  TOPICS_PER_WEEK_PER_SUBJECT,
  liveLoad,
  minutesPerDay,
  type QuestionLoad,
} from "@/lib/practice/questionLoad";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAvatarUrl } from "@/hooks/data/useAvatar";
import {
  AVATAR_ACCEPT,
  AVATAR_BUCKET,
  avatarObjectPath,
  prepareAvatar,
} from "@/lib/profile/avatar";
import { resolveInitials } from "@/lib/profile/displayName";
import { firstError, validateEmail, validatePassword, validatePhone } from "@/lib/auth/validation";
import { DISPLAY_NAME_MAX, PHONE_MAX } from "@/lib/platform/textLimits";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile | Anglia Educate" }] }),
  component: ProfilePage,
});

type SettingKey = "name" | "exams" | "questions" | "email" | "password";

/** Each tile: its emoji, its name, its colour, and what its button says. */
const SETTINGS: Record<
  SettingKey,
  { label: string; emoji: string; tint: string; title: string; action: string }
> = {
  name: {
    label: "You",
    emoji: "🙂",
    tint: "tint-primary",
    title: "Your name and number",
    action: "Change details",
  },
  exams: {
    label: "Exams",
    emoji: "🗓️",
    tint: "tint-amber",
    title: "Your exam year",
    action: "Change year",
  },
  questions: {
    label: "Questions",
    emoji: "🎯",
    tint: "tint-accent",
    title: "How many questions",
    action: "Change amount",
  },
  email: {
    label: "Email",
    emoji: "✉️",
    tint: "tint-emerald",
    title: "Your email",
    action: "Change email",
  },
  password: {
    label: "Password",
    emoji: "🔑",
    tint: "tint-rose",
    title: "Your password",
    action: "Change password",
  },
};

const LOAD_WORD: Record<QuestionLoad, { emoji: string; name: string }> = {
  reduced: { emoji: "🪶", name: "Reduced" },
  normal: { emoji: "🎯", name: "Normal" },
  enhanced: { emoji: "🚀", name: "Enhanced" },
};

/** Called by a form once it has saved, so the dialog it sits in can close. */
const DoneContext = createContext<() => void>(() => {});

/** The points in this week's plan, across every subject: what the minutes are worked from. */
function useWeekPoints() {
  const studentId = useViewerId();
  const isStudent = useIsStudent();
  const { enrolments } = useEnrolments();
  const week = useQuery({
    queryKey: ["profile-week-points", studentId],
    enabled: isStudent && !!studentId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("student_weekly_plan_points")
        .select("spec_point_id, student_weekly_plans!inner(student_id)", {
          count: "exact",
          head: true,
        })
        .eq("student_weekly_plans.student_id", studentId!)
        .eq("student_weekly_plans.week_start", currentWeekKey());
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  return {
    ...week,
    // With no plan this week (a new student, a break), worked as at sign-up.
    topicsPerWeek: week.data || enrolments.length * TOPICS_PER_WEEK_PER_SUBJECT,
  };
}

/**
 * One tile, as on the planner's summary: its emoji and name, what it is now,
 * and one button at its foot whose emoji hops when pointed at.
 */
function Tile({
  k,
  wide,
  onOpen,
  children,
}: {
  k: SettingKey;
  wide?: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const s = SETTINGS[k];
  return (
    <section
      className={cn(
        "premium-card summary-card flex flex-col gap-4 rounded-2xl p-5 sm:p-6",
        s.tint,
        wide && "md:col-span-2",
      )}
    >
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        <span aria-hidden>{s.emoji}</span> {s.label}
      </h2>
      {children}
      <button
        type="button"
        onClick={onOpen}
        className="btn-solid summary-go mt-auto inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-base"
      >
        <span aria-hidden className="summary-emoji">
          ✏️
        </span>
        {s.action}
      </button>
    </section>
  );
}

/** The tile's figure, in its dot or ring, and the plain words beside it. */
function Figure({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 text-lg leading-tight font-bold">{children}</div>;
}

/**
 * The form behind a tile, in the Ask your tutor dialog's look: a solid round
 * dot, the title with the highlighter stroke, and the form under it. It closes
 * once the form has saved.
 */
function EditDialog({
  k,
  email,
  onClose,
}: {
  k: SettingKey;
  email: string | null;
  onClose: () => void;
}) {
  const s = SETTINGS[k];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <AbovePage>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-primary-deep/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-edit-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className={cn(
            "ask-sheet premium-card flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-3xl shadow-xl",
            k === "questions" ? "max-w-2xl" : "max-w-lg",
            s.tint,
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 sm:px-7 sm:pt-7">
            <div className="flex min-w-0 items-center gap-4">
              <span className="paywall-dot ask-dot text-2xl" aria-hidden>
                {s.emoji}
              </span>
              <div className="min-w-0">
                <h2
                  id="profile-edit-title"
                  className="text-2xl leading-tight font-extrabold sm:text-3xl"
                >
                  {s.title}
                </h2>
                <Squiggle className="w-28" />
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="btn-ghost flex size-11 shrink-0 items-center justify-center rounded-full"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7 sm:pb-7">
            <DoneContext.Provider value={onClose}>
              {k === "name" && <DetailsCard />}
              {k === "exams" && <ExamYearCard />}
              {k === "questions" && <QuestionLoadCard />}
              {k === "email" && <EmailCard currentEmail={email} />}
              {k === "password" && <PasswordCard currentEmail={email} />}
            </DoneContext.Provider>
          </div>
        </div>
      </div>
    </AbovePage>
  );
}

const popInput = "pop-input mt-2 h-12 w-full px-4 text-base";

/** A field: its name as plain bold words over the box, any problem in red under it. */
function PopField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block">
        <span className="ask-label">{label}</span>
        {children}
      </label>
      {error && <p className="text-destructive mt-2 text-sm font-semibold">{error}</p>}
    </div>
  );
}

/**
 * The one big button, drawn only once there is something to save: an empty
 * form shows no greyed-out button.
 */
function SaveButton({
  show,
  busy,
  children,
  onClick,
}: {
  show: boolean;
  busy: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  if (!show && !busy) return null;
  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={busy}
      className="btn-solid paywall-btn pop-in w-full sm:w-auto"
    >
      {busy && <Loader2 className="size-5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Students only: nobody else has an exam year or is set questions. */
function useIsStudent() {
  const { isTutor } = useRoles();
  const { role, level, enrolments } = useEnrolments();
  return !isTutor && role === "student" && !!level && enrolments.length > 0;
}

/**
 * The profile row, read once for every card on this page.
 *
 * Both the photo and the name/phone form live on the same row, so they share a
 * query key and React Query serves the second caller from the cache. Saving
 * from either card invalidates this key, which is what keeps the photo preview
 * and the header avatar in step.
 */
function useProfileDetails() {
  return useQuery({
    queryKey: ["profile-details"],
    queryFn: async () => {
      // The session held here, not a call to the auth API: when that call
      // failed it came back as nobody, the form showed empty, and Save then
      // wrote the empty name over the real one. The guard has already checked
      // the session, and RLS checks the read. Thrown, so a failure is an error
      // with Try again rather than a cached "no details".
      const uid = await getSessionUserId();
      if (!uid) throw new Error("Your session has expired. Sign in again.");
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, phone, avatar_path")
        .eq("id", uid)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/**
 * The profile photo.
 *
 * One object per account at a fixed path, overwritten in place, so there is
 * never a second file to garbage-collect when someone changes their mind.
 */
function usePhoto(currentEmail: string | null) {
  const qc = useQueryClient();
  // Who this is, as the guard resolved it: asking the auth API again on each
  // tap said "session expired" whenever that call dropped.
  const userId = useViewerId();
  const { data, isLoading } = useProfileDetails();
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Two different questions, deliberately answered by two different values.
  // The path says whether a photo EXISTS, so "Remove" appears the moment the
  // row loads; the signed URL says whether it can be DRAWN yet, and arrives a
  // beat later. Driving both off the URL would flicker the buttons on every
  // re-sign.
  const avatarPath = data?.avatar_path ?? null;
  const avatarUrl = useAvatarUrl(avatarPath);

  /**
   * Every writer refreshes the same three readers: this card, the header, and
   * the signed URL — which must be re-minted after a replacement, or the token
   * already in hand would go on serving the previous photo.
   */
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["profile-details"] });
    qc.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });
    qc.invalidateQueries({ queryKey: ["avatar-signed-url"] });
  };

  const onPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input before anything can fail: without this, choosing the same
    // file again after an error fires no change event and the picker looks dead.
    e.target.value = "";
    if (!file) return;

    setBusy("upload");
    try {
      const prepared = await prepareAvatar(file);
      if (!prepared.ok) {
        toast.error(prepared.reason);
        return;
      }

      if (!userId) throw new Error("Your session has expired. Sign in again.");

      const path = avatarObjectPath(userId);
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, prepared.file, { upsert: true, contentType: "image/jpeg" });
      if (uploadError) throw new Error(uploadError.message);

      // The path, not a URL. A signed URL expires, so storing one would store
      // something that stops working a few minutes later; the path is stable
      // and the URL is minted per read.
      const { error: saveError } = await supabase
        .from("profiles")
        .update({ avatar_path: path })
        .eq("id", userId);
      if (saveError) throw new Error(saveError.message);

      refresh();
      toast.success("Photo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload your photo");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      if (!userId) throw new Error("Your session has expired. Sign in again.");

      // Clear the row first. If the object delete then fails we are merely
      // holding an unreferenced file, whereas the other order would leave the
      // profile pointing at something that no longer exists.
      const { error: saveError } = await supabase
        .from("profiles")
        .update({ avatar_path: null })
        .eq("id", userId);
      if (saveError) throw new Error(saveError.message);
      await supabase.storage.from(AVATAR_BUCKET).remove([avatarObjectPath(userId)]);

      refresh();
      toast.success("Photo removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove your photo");
    } finally {
      setBusy(null);
    }
  };

  return {
    avatarUrl,
    avatarPath,
    busy,
    ready: !isLoading,
    initials: resolveInitials(data?.display_name, currentEmail),
    pick: () => picker.current?.click(),
    remove,
    input: (
      <input
        ref={picker}
        type="file"
        accept={AVATAR_ACCEPT}
        onChange={onPicked}
        className="hidden"
      />
    ),
  };
}

type Photo = ReturnType<typeof usePhoto>;

/**
 * The photo as a big round dot you press to change. A yellow camera sits on
 * its edge and hops when the dot is pointed at; Remove is a bare link beside.
 */
function Avatar({ photo }: { photo: Photo }) {
  return (
    <>
      <button
        type="button"
        onClick={photo.pick}
        disabled={!photo.ready || photo.busy !== null}
        data-busy={photo.busy !== null}
        aria-label={photo.avatarPath ? "Change your photo" : "Add a photo"}
        className="profile-avatar tint-primary"
      >
        {photo.avatarUrl ? (
          <img src={photo.avatarUrl} alt="" width={112} height={112} />
        ) : (
          // Also what shows for the moment between the row loading and its
          // URL being signed, which is why it isn't a spinner.
          <span aria-hidden>{photo.initials}</span>
        )}
        <span className="profile-avatar-badge" aria-hidden>
          {photo.busy ? <Loader2 className="animate-spin" /> : <Camera />}
        </span>
      </button>
      {photo.input}
    </>
  );
}

function RemovePhoto({ photo }: { photo: Photo }) {
  if (!photo.avatarPath) return null;
  return (
    <button
      type="button"
      onClick={photo.remove}
      disabled={photo.busy !== null}
      className="paywall-link -ml-3.5"
    >
      <Trash2 className="size-4" aria-hidden />
      Remove photo
    </button>
  );
}

/** Account details held on the profile row, as opposed to the auth user. */
function DetailsCard() {
  const done = useContext(DoneContext);
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const userId = useViewerId();

  const { data, isLoading, error: readError, refetch } = useProfileDetails();

  // Seed the inputs from the row exactly once.
  //
  // React Query hands back a new `data` object on every refetch, and the client
  // is built with default options — so refetchOnWindowFocus is on. Seeding on
  // every `data` change therefore wipes whatever you had typed the moment the
  // window regains focus, and the stale value gets saved over your edit while
  // the form still reports success. The ref pins seeding to the first row that
  // arrives; after that the inputs belong to the user.
  const seeded = useRef(false);
  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    setDisplayName(data.display_name ?? "");
    setPhone(data.phone ?? "");
  }, [data]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validatePhone(phone);
    setPhoneError(error);
    if (error) return;

    setSaving(true);
    try {
      if (!userId) throw new Error("Your session has expired. Sign in again.");

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          display_name: displayName.trim() || null,
          // Empty clears the number rather than storing "".
          phone: phone.trim() || null,
        })
        .eq("id", userId);
      if (updateError) throw new Error(updateError.message);

      // The header initials and the invite notifications both read these.
      qc.invalidateQueries({ queryKey: ["profile-details"] });
      qc.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });
      toast.success("Details saved");
      done();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your details");
    } finally {
      setSaving(false);
    }
  };

  // Save shows once something differs from what is saved.
  const changed =
    data != null &&
    (displayName.trim() !== (data.display_name ?? "") || phone.trim() !== (data.phone ?? ""));

  return (
    <>
      {readError && data === undefined && (
        <div className="mb-4 max-w-md">
          <ErrorNote error={readError} onRetry={() => void refetch()} />
        </div>
      )}
      <form onSubmit={submit} className="max-w-md space-y-5">
        <PopField label="Your name">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX}
            placeholder={isLoading ? "Loading…" : "e.g. Alex Taylor"}
            className={popInput}
          />
        </PopField>
        <PopField label="Phone number" error={phoneError}>
          <input
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (phoneError) setPhoneError(null);
            }}
            onBlur={() => setPhoneError(validatePhone(phone))}
            maxLength={PHONE_MAX}
            placeholder="e.g. +44 7700 900123"
            aria-invalid={!!phoneError}
            className={popInput}
          />
        </PopField>
        {/* Held until the row is read: unread, the form is empty, and saving
            it would wipe the name and number. */}
        <SaveButton show={changed} busy={saving}>
          {saving ? "Saving…" : "Save"}
        </SaveButton>
      </form>
    </>
  );
}

/** The year on the profile, and the years the plans are set to. */
function useExamYear() {
  const studentId = useViewerId();
  const isStudent = useIsStudent();
  return useQuery({
    queryKey: ["profile-exam-year", studentId],
    enabled: isStudent && !!studentId,
    queryFn: async () => {
      const [profile, plans] = await Promise.all([
        supabase.from("profiles").select("exam_year").eq("id", studentId!).maybeSingle(),
        supabase.from("student_program_plan").select("exam_date").eq("student_id", studentId!),
      ]);
      if (profile.error) throw new Error(profile.error.message);
      if (plans.error) throw new Error(plans.error.message);
      return {
        examYear: profile.data?.exam_year ?? null,
        planYears: (plans.data ?? []).map((p) => Number(p.exam_date.slice(0, 4))),
      };
    },
  });
}

/** The year on the profile; before anyone was asked, the year the plans share. */
function currentExamYear(
  data: { examYear: number | null; planYears: number[] } | undefined,
  level: Parameters<typeof examYearOptions>[0],
) {
  const options = examYearOptions(level);
  const onOffer = (year: number | null | undefined) =>
    year != null && options.some((o) => o.year === year) ? year : null;
  const planYears = data?.planYears ?? [];
  return (
    onOffer(data?.examYear) ??
    (planYears.length > 0 && planYears.every((y) => y === planYears[0])
      ? onOffer(planYears[0])
      : null)
  );
}

/**
 * The summer a student sits their exams. Asked at sign-up; this is where it
 * changes after. Picking a year moves every subject to that June at once
 * (`ProgramDAL.setExamYear`). The planner's date box moves one subject at a
 * time, and left this answer wrong, which a subject added later is planned to.
 *
 * Students only. The level stays with the tutor: a new level is a different
 * qualification, and can be a different price.
 */
function ExamYearCard() {
  const qc = useQueryClient();
  const done = useContext(DoneContext);
  const { isTutor } = useRoles();
  const { role, level, enrolments } = useEnrolments();
  const studentId = useViewerId();
  const isStudent = !isTutor && role === "student" && !!level && enrolments.length > 0;
  const [picked, setPicked] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, error, refetch, isLoading } = useExamYear();

  if (!isStudent || !studentId || !level) return null;

  const options = examYearOptions(level);
  const planYears = data?.planYears ?? [];
  const current = currentExamYear(data, level);
  const selected = picked ?? current;
  // Only a tap changes anything. Before one, the tile shown may be a guess from
  // the plans (nobody was asked before 7 Oct), and Save would only confirm it.
  const changes =
    picked != null && (picked !== data?.examYear || planYears.some((year) => year !== picked));
  // Earlier exams squeeze every subject's weeks, so that is asked first.
  const earlier = selected != null && planYears.some((year) => year > selected);

  const save = async () => {
    if (selected == null) return;
    setSaving(true);
    try {
      const { refused } = await ProgramDAL.setExamYear({
        studentId,
        year: selected,
        level,
        courses: enrolments.map((e) => ({
          subject: e.subject as SubjectV,
          board: e.board as BoardV,
        })),
      });
      await Promise.all([
        invalidatePlanner(qc, studentId),
        qc.invalidateQueries({ queryKey: ["profile-exam-year"] }),
      ]);
      // The year is saved either way; a subject that couldn't move says why.
      toast.success(
        refused.length === 0
          ? `Exams set to summer ${selected}.`
          : `Exam year saved: summer ${selected}.`,
      );
      for (const r of refused) toast.error(`${subjectLabel(r.subject)}: ${r.message}`);
      setPicked(null);
      setConfirming(false);
      done();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your exam year. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {error ? (
        <ErrorNote error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <Spinner className="py-6" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {options.map((o) => (
              <ChoiceTile
                key={o.year}
                title={o.label}
                selected={selected === o.year}
                onClick={() => {
                  setPicked(o.year);
                  setConfirming(false);
                }}
              />
            ))}
          </div>
          {confirming ? (
            <div className="point-panel">
              <p className="text-lg font-medium">
                Move every subject’s exams to <span className="font-bold">summer {selected}</span>?
                Your weeks get fuller to fit the course in.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <SaveButton show busy={saving} onClick={() => void save()}>
                  Move my exams
                </SaveButton>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setConfirming(false)}
                  className="paywall-link"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <SaveButton
              show={changes}
              busy={saving}
              onClick={() => (earlier ? setConfirming(true) : void save())}
            >
              {saving ? "Saving…" : "Save"}
            </SaveButton>
          )}
        </div>
      )}
    </>
  );
}

/**
 * How many of each topic's questions a student is set: Reduced, Normal or
 * Enhanced. Asked at sign-up; this is where it changes after. It takes effect
 * from the next quiz started and the next task handed in. Work already filed
 * keeps the count it was filed with (`shown_count`).
 *
 * The minutes a day are for this week's points on the plan, across every
 * subject. With no plan this week (a new student, a break) they are worked as
 * at sign-up, from one topic a day for each subject.
 *
 * Students only: nobody else is set quizzes or tasks.
 */
function QuestionLoadCard() {
  const qc = useQueryClient();
  const done = useContext(DoneContext);
  const { isTutor } = useRoles();
  const { role, level, enrolments } = useEnrolments();
  const studentId = useViewerId();
  const isStudent = !isTutor && role === "student" && !!level && enrolments.length > 0;
  const [picked, setPicked] = useState<QuestionLoad | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = useQuestionLoad(isStudent ? studentId : null);

  const week = useWeekPoints();

  if (!isStudent || !studentId) return null;

  const selected = picked ?? saved.load;
  const error = saved.error ?? week.error;

  const save = async () => {
    setSaving(true);
    try {
      const { error: saveError } = await supabase
        .from("profiles")
        .update({ question_load: selected })
        .eq("id", studentId);
      if (saveError) throw dbError(saveError);
      // The quiz and task pages cut to the level they read here.
      qc.setQueryData(questionLoadKey(studentId), selected);
      setPicked(null);
      toast.success("Saved. It starts with your next quiz and task.");
      done();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {error ? (
        <ErrorNote
          error={error}
          onRetry={() => {
            saved.retry();
            void week.refetch();
          }}
        />
      ) : !saved.ready || week.isLoading ? (
        <Spinner className="py-6" />
      ) : (
        <div className="space-y-6">
          <QuestionLoadPicker
            value={selected}
            onChange={setPicked}
            topicsPerWeek={week.topicsPerWeek}
          />
          <SaveButton show={selected !== saved.load} busy={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </SaveButton>
        </div>
      )}
    </>
  );
}

function EmailCard({ currentEmail }: { currentEmail: string | null }) {
  const done = useContext(DoneContext);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = email.trim().toLowerCase();
    let problem = validateEmail(next);
    if (!problem && next === currentEmail?.toLowerCase()) {
      problem = "That is already your email address";
    }
    setError(problem);
    if (problem) return;

    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ email: next });
      if (updateError) throw new Error(updateError.message);
      // Supabase does not move the address until the link is clicked, so the
      // header will keep showing the old one until then — say so, or this reads
      // as a silent no-op.
      // With secure email change on, the current address gets a link too, and
      // both have to be clicked.
      toast.success(
        `Confirmation sent to ${next}. If your current address gets one too, click both. Your email changes once that's done.`,
      );
      setEmail("");
      done();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update your email");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} className="max-w-md space-y-5">
        <PopField label="New email" error={error}>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            onBlur={() => email && setError(validateEmail(email))}
            aria-invalid={!!error}
            className={popInput}
          />
        </PopField>
        <SaveButton show={email.trim() !== ""} busy={saving}>
          {saving ? "Sending…" : "Send confirmation"}
        </SaveButton>
      </form>
    </>
  );
}

function PasswordCard({ currentEmail }: { currentEmail: string | null }) {
  const done = useContext(DoneContext);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    let problem = firstError(next, validatePassword);
    if (!problem && next !== confirm) problem = "The new passwords do not match";
    if (!problem && next === current)
      problem = "Your new password must differ from the current one";
    if (!problem && !current) problem = "Enter your current password";
    setError(problem);
    if (problem) return;

    if (!currentEmail) {
      toast.error("Your session has expired. Sign in again.");
      return;
    }

    setSaving(true);
    try {
      // Re-authenticate first: an open session alone shouldn't be enough to
      // change the password on it, or a borrowed laptop becomes an account
      // takeover. A failed sign-in leaves the existing session intact.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: currentEmail,
        password: current,
      });
      if (reauthError) {
        setError("Your current password is incorrect");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      // Surfaces Supabase's own rejections (minimum length, and breached-password
      // checks if leaked-password protection is ever enabled — it is currently
      // off on the live project despite config.toml claiming otherwise).
      if (updateError) throw new Error(updateError.message);

      toast.success("Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
      done();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update your password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} className="max-w-md space-y-5">
        <PopField label="Current password">
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={popInput}
          />
        </PopField>
        <PopField label="New password">
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              if (error) setError(null);
            }}
            className={popInput}
          />
        </PopField>
        <PopField label="New password again" error={error}>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={!!error}
            className={popInput}
          />
        </PopField>
        <SaveButton show={current !== "" || next !== "" || confirm !== ""} busy={saving}>
          {saving ? "Updating…" : "Update password"}
        </SaveButton>
      </form>
    </>
  );
}

function ProfilePage() {
  const viewerId = useViewerId();
  const { email: sessionEmail } = useRoles();
  const { data: user } = useQuery({
    queryKey: ["auth-user-email"],
    queryFn: async () => {
      // Thrown, not answered with nobody: a failed refetch then keeps the
      // address already shown instead of blanking it.
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user ?? null;
    },
  });
  // The server's answer, which follows a confirmed email change; until it
  // arrives (or if it can't), the address held in this browser.
  const email = user?.email ?? sessionEmail ?? null;

  return (
    <AppLayout title="Profile">
      {/* Keyed by account, as the guard resolved it: if someone else signs in
          on this tab, the forms start again empty rather than keep (and save)
          the last person's details. Not by the auth API's answer, which came
          back as nobody whenever a refetch failed, and remounted every card
          empty over whatever the student was typing. */}
      <ProfileTiles key={viewerId ?? "nobody"} email={email} />
    </AppLayout>
  );
}

/**
 * The page as tiles, like the planner's summary: what each thing is now, and
 * one button on each that opens its form in a dialog.
 */
function ProfileTiles({ email }: { email: string | null }) {
  const photo = usePhoto(email);
  const { data } = useProfileDetails();
  const isStudent = useIsStudent();
  const { level } = useEnrolments();
  const studentId = useViewerId();
  const exam = useExamYear();
  const load = useQuestionLoad(isStudent ? studentId : null);
  const week = useWeekPoints();
  const [open, setOpen] = useState<SettingKey | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const name = data?.display_name?.trim();
  const phone = data?.phone?.trim();
  const year = level ? currentExamYear(exam.data, level) : null;
  const weeksToGo =
    year != null
      ? Math.max(0, Math.ceil((examMondayIn(year).getTime() - Date.now()) / (7 * 864e5)))
      : null;
  const picked = liveLoad(load.load);
  const minutes = minutesPerDay(picked, week.topicsPerWeek);
  const share = (minutes / minutesPerDay(HEAVIEST_LIVE_LOAD, week.topicsPerWeek)) * 100;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Tile k="name" wide={isStudent} onOpen={() => setOpen("name")}>
          <div className="flex items-center gap-5">
            <Avatar photo={photo} />
            <div className="min-w-0">
              <p className="font-display text-3xl leading-tight font-extrabold break-words">
                {name || "Add your name"}
              </p>
              <p className="mt-1 text-lg font-semibold">{phone || "No phone number yet"}</p>
              <RemovePhoto photo={photo} />
            </div>
          </div>
        </Tile>

        {isStudent && (
          <Tile k="exams" onOpen={() => setOpen("exams")}>
            {year != null ? (
              <>
                <Figure>
                  <span className="summary-dot numeral pop-in">{weeksToGo}</span>
                  {weeksToGo === 1 ? "week to go" : "weeks to go"}
                </Figure>
                <p className="text-lg font-bold">Exams in summer {year}</p>
              </>
            ) : exam.isLoading ? (
              <Spinner className="py-4" />
            ) : (
              <p className="text-lg font-bold">Pick the summer you sit your exams</p>
            )}
          </Tile>
        )}

        {isStudent && (
          <Tile k="questions" onOpen={() => setOpen("questions")}>
            {load.ready && !week.isLoading ? (
              <>
                <Figure>
                  <Ring key={picked} value={share} size={72} stroke={8} className="shrink-0">
                    <span className={cn("numeral text-[1.75rem]", TINT_TEXT)}>{minutes}</span>
                  </Ring>
                  minutes a day
                </Figure>
                <p className="text-lg font-bold">
                  <span aria-hidden>{LOAD_WORD[picked].emoji}</span> {LOAD_WORD[picked].name}
                </p>
              </>
            ) : (
              <Spinner className="py-4" />
            )}
          </Tile>
        )}

        <Tile k="email" onOpen={() => setOpen("email")}>
          <p className="font-display text-xl leading-snug font-extrabold break-all">
            {email ?? "…"}
          </p>
        </Tile>

        <Tile k="password" onOpen={() => setOpen("password")}>
          <Figure>
            <span className="summary-dot pop-in" aria-hidden>
              🔒
            </span>
            Kept private
          </Figure>
        </Tile>
      </div>
      {open && <EditDialog k={open} email={email} onClose={close} />}
    </>
  );
}
