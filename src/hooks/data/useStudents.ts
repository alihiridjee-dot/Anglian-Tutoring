import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StudentsDAL, type EnrolmentPatch } from "@/lib/students/studentsDal";
import { BILLING_KEY } from "@/hooks/data/useBilling";
import type { LevelV, SubjectV } from "@/lib/curriculum/taxonomy";

/**
 * The tutor's view of students, keyed so the roster and one student's record
 * cache separately and one invalidate refreshes the lot.
 *
 * `useStudentRecord` is the one fetch the record page's tabs share: profile,
 * enrolments, subscription, parents, invites and billing feedback arrive
 * together, and a tab that needs more (submissions, attempts, threads, notes)
 * adds its own query under the same student key rather than re-reading these.
 */
export const STUDENTS_KEY = ["students"] as const;
export const studentKey = (studentId: string) => [...STUDENTS_KEY, "record", studentId] as const;

export function useStudentDirectory() {
  return useQuery({
    queryKey: [...STUDENTS_KEY, "directory"],
    queryFn: () => StudentsDAL.listDirectory(),
    staleTime: 1000 * 60,
  });
}

export function useRosterEnrolments() {
  return useQuery({
    queryKey: [...STUDENTS_KEY, "roster-enrolments"],
    queryFn: () => StudentsDAL.listEnrolmentsByStudent(),
    staleTime: 1000 * 60,
  });
}

export function useRosterSubscriptions() {
  return useQuery({
    queryKey: [...STUDENTS_KEY, "roster-subscriptions"],
    queryFn: () => StudentsDAL.listSubscriptionsByStudent(),
    staleTime: 1000 * 60,
  });
}

export function useStudentRecord(studentId: string | null) {
  return useQuery({
    queryKey: studentKey(studentId ?? ""),
    queryFn: () => StudentsDAL.getRecord(studentId!),
    enabled: !!studentId,
    staleTime: 30_000,
  });
}

export function useStudentNotes(studentId: string | null) {
  return useQuery({
    queryKey: [...studentKey(studentId ?? ""), "notes"],
    queryFn: () => StudentsDAL.listNotes(studentId!),
    enabled: !!studentId,
  });
}

export function useStudentSubmissions(studentId: string | null) {
  return useQuery({
    queryKey: [...studentKey(studentId ?? ""), "submissions"],
    queryFn: () => StudentsDAL.listSubmissions(studentId!),
    enabled: !!studentId,
  });
}

export function useStudentAttempts(studentId: string | null) {
  return useQuery({
    queryKey: [...studentKey(studentId ?? ""), "attempts"],
    queryFn: () => StudentsDAL.listAttempts(studentId!),
    enabled: !!studentId,
  });
}

export function useStudentThreads(studentId: string | null) {
  return useQuery({
    queryKey: [...studentKey(studentId ?? ""), "threads"],
    queryFn: () => StudentsDAL.listThreads(studentId!),
    enabled: !!studentId,
  });
}

/**
 * Level and board decide every piece of content on the account, so a change
 * to either invalidates everything — the same blanket rule the student's own
 * board switch applies, and for the same reason: a key missed here leaves a
 * page showing another qualification's spec.
 */
function invalidateCourse(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries();
}

export function useSetStudentLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, level }: { studentId: string; level: LevelV }) =>
      StudentsDAL.setLevel(studentId, level),
    onSuccess: () => invalidateCourse(qc),
  });
}

export function useUpdateStudentEnrolment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      studentId,
      subject,
      patch,
    }: {
      studentId: string;
      subject: SubjectV;
      patch: EnrolmentPatch;
    }) => StudentsDAL.updateEnrolment(studentId, subject, patch),
    onSuccess: (_row, vars) => {
      if (vars.patch.board !== undefined) invalidateCourse(qc);
      else void qc.invalidateQueries({ queryKey: STUDENTS_KEY });
    },
  });
}

export function useUnlinkParent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId }: { linkId: string; studentId: string }) =>
      StudentsDAL.unlinkParent(linkId),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: studentKey(vars.studentId) });
      // Who may manage the plan depends on the links, and so does what the
      // billing tab offers.
      void qc.invalidateQueries({ queryKey: BILLING_KEY });
    },
  });
}

export function useAddStudentNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, body }: { studentId: string; body: string }) =>
      StudentsDAL.addNote(studentId, body),
    onSuccess: (_n, vars) =>
      void qc.invalidateQueries({ queryKey: [...studentKey(vars.studentId), "notes"] }),
  });
}

export function useUpdateStudentNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string; studentId: string }) =>
      StudentsDAL.updateNote(noteId, body),
    onSuccess: (_n, vars) =>
      void qc.invalidateQueries({ queryKey: [...studentKey(vars.studentId), "notes"] }),
  });
}

export function useDeleteStudentNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId }: { noteId: string; studentId: string }) =>
      StudentsDAL.deleteNote(noteId),
    onSuccess: (_n, vars) =>
      void qc.invalidateQueries({ queryKey: [...studentKey(vars.studentId), "notes"] }),
  });
}

/** The deletion booked on a student, if any — shown in the header and on Billing. */
export function useAccountDeletion(studentId: string) {
  return useQuery({
    queryKey: [...studentKey(studentId), "deletion"],
    queryFn: () => StudentsDAL.getOpenDeletion(studentId),
    staleTime: 30_000,
  });
}

/**
 * Booking or undoing a deletion also pauses or resumes the plan and locks or
 * unlocks the login, so the roster and billing refresh too, not just the record.
 */
function useDeletionMutation<T>(fn: (studentId: string) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId }: { studentId: string }) => fn(studentId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: STUDENTS_KEY });
      void qc.invalidateQueries({ queryKey: BILLING_KEY });
    },
  });
}

export function useScheduleDeletion() {
  return useDeletionMutation((id) => StudentsDAL.scheduleDeletion(id));
}

export function useUndoDeletion() {
  return useDeletionMutation((id) => StudentsDAL.undoDeletion(id));
}
