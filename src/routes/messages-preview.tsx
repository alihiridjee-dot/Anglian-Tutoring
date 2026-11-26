import { useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EmptyInbox } from "@/components/chat/EmptyInbox";
import { TutorNewThreadDialog } from "@/components/chat/TutorNewThreadDialog";
import { StudentMessages } from "@/components/students/StudentMessages";
import { STUDENTS_KEY, studentKey } from "@/hooks/data/useStudents";
import type { DirectoryStudent, StudentRecord, StudentThread } from "@/lib/students/studentsDal";

// DEV ONLY — a tutor writing first, drawn over made-up students. No session
// can sign in as a tutor, so this is where the tutor's "New message" sheet and
// the record's Messages tab are looked at. The reads come from a private
// cache filled below; Send goes to the real database, where these made-up
// ids do not exist, so nothing is written.
export const Route = createFileRoute("/messages-preview")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Tutor messages — Anglia Educate" }] }),
  component: MessagesPreview,
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALEX = id(1);
const PRIYA = id(2);
const TOM = id(3);
const NOAH = id(4);

const student = (sid: string, name: string | null, email: string): DirectoryStudent => ({
  id: sid,
  display_name: name,
  email,
  created_at: "2026-09-01T09:00:00Z",
  last_active_at: "2026-11-20T18:00:00Z",
  last_sign_in_at: "2026-11-20T18:00:00Z",
  level: "gcse",
  onboarding_completed_at: "2026-09-01T09:10:00Z",
  school: null,
  student_invite_code: null,
});

const DIRECTORY = [
  student(ALEX, "Alex Morgan", "alex.morgan@example.com"),
  student(PRIYA, "Priya Shah", "priya.shah@example.com"),
  student(TOM, "Tom Becker", "tom.becker@example.com"),
  student(NOAH, null, "noah.w@example.com"),
];

const PARENTS: Record<string, [string, string][]> = {
  [ALEX]: [[id(11), "Jane Morgan"]],
  [PRIYA]: [
    [id(12), "Raj Shah"],
    [id(13), "Meera Shah"],
  ],
};

const record = (s: DirectoryStudent): StudentRecord => ({
  profile: {
    id: s.id,
    display_name: s.display_name,
    level: s.level,
    school: null,
    phone: null,
    avatar_path: null,
    student_invite_code: null,
    question_load: "normal",
    created_at: s.created_at,
    onboarding_completed_at: s.onboarding_completed_at,
  },
  enrolments: [],
  subscription: null,
  parents: (PARENTS[s.id] ?? []).map(([pid, name]) => ({
    link_id: `${pid}-link`,
    parent_id: pid,
    display_name: name,
    linked_at: "2026-09-02T10:00:00Z",
  })),
  pendingInvites: [],
  billingFeedback: [],
});

const PRIYA_THREADS: StudentThread[] = [
  {
    id: id(21),
    subject_line: "Saturday's lesson",
    subject: null,
    status: "answered",
    context_label: null,
    last_message_at: "2026-11-21T09:30:00Z",
    tutor_last_read_at: "2026-11-21T09:30:00Z",
    about_student_id: PRIYA,
  },
  {
    id: id(22),
    subject_line: "Osmosis practical",
    subject: "biology",
    status: "open",
    context_label: "B1.3 Osmosis",
    last_message_at: "2026-11-20T16:05:00Z",
    tutor_last_read_at: "2026-11-19T12:00:00Z",
    about_student_id: null,
  },
];

/** A cache that never goes stale, so nothing here asks the real database. */
function seeded(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const never = { updatedAt: Date.now() + 1000 * 60 * 60 * 24 * 365 };
  client.setQueryData([...STUDENTS_KEY, "directory"], DIRECTORY, never);
  for (const s of DIRECTORY) client.setQueryData(studentKey(s.id), record(s), never);
  client.setQueryData([...studentKey(PRIYA), "threads"], PRIYA_THREADS, never);
  client.setQueryData([...studentKey(TOM), "threads"], [], never);
  return client;
}

function MessagesPreview() {
  const [client] = useState(seeded);
  const [composing, setComposing] = useState(false);

  return (
    <QueryClientProvider client={client}>
      <main className="mx-auto max-w-4xl space-y-10 px-4 py-8">
        <h1>Tutor messages</h1>
        <EmptyInbox isTutor onAsk={() => setComposing(true)} />
        <div>
          <h2 className="mb-4 text-xl">Priya&apos;s record, Messages tab</h2>
          <StudentMessages studentId={PRIYA} />
        </div>
        <div>
          <h2 className="mb-4 text-xl">Tom&apos;s record, Messages tab</h2>
          <StudentMessages studentId={TOM} />
        </div>
        {composing && (
          <TutorNewThreadDialog
            onClose={() => setComposing(false)}
            onCreated={() => setComposing(false)}
          />
        )}
      </main>
    </QueryClientProvider>
  );
}
