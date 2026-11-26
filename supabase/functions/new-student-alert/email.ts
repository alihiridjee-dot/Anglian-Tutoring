// The email the new-student-alert function sends the team when a student
// finishes setting up their account.
//
// Pure — no Deno, no network — so the wording is tested from bun
// (src/lib/students/newStudentAlertEmail.test.ts) and the function only has to
// deliver it.

export interface NewStudent {
  id: string;
  name: string | null;
  email: string | null;
  level: string | null;
  examYear: number | null;
  school: string | null;
  /** "email", "google", "azure" … as Supabase Auth names it. */
  provider: string | null;
  subjects: { subject: string; board: string | null; targetGrade: string | null }[];
}

export interface Email {
  subject: string;
  text: string;
  html: string;
}

const BRAND = "Anglia Educate";

// Copies of src/lib/curriculum/taxonomy.ts (the function can't import from
// the app). The test checks they still match.
export const LEVEL_LABELS: Record<string, string> = {
  gcse: "GCSE",
  gcse_trilogy: "GCSE Combined Science (Trilogy)",
  igcse: "International GCSE",
  alevel: "A-Level",
};
export const BOARD_LABELS: Record<string, string> = {
  edexcel: "Edexcel",
  aqa: "AQA",
  ocr: "OCR",
  cambridge: "Cambridge",
  oxford_aqa: "OxfordAQA",
};
export const SUBJECT_LABELS: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};
const PROVIDER_LABELS: Record<string, string> = {
  email: "Email and password",
  google: "Google",
  azure: "Microsoft",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One line, no control characters, capped: what a student typed is never trusted. */
function oneLine(s: string, max = 80): string {
  const flat = s
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function subjectLine(s: NewStudent["subjects"][number]): string {
  const subject = SUBJECT_LABELS[s.subject] ?? s.subject;
  const board = s.board ? (BOARD_LABELS[s.board] ?? s.board) : null;
  const target = s.targetGrade ? oneLine(s.targetGrade, 10) : null;
  return [`${subject}${board ? ` (${board})` : ""}`, target ? `aiming for ${target}` : null]
    .filter(Boolean)
    .join(", ");
}

/** The team's email about one student, with a link to their page on the Students screen. */
export function buildNewStudentEmail(student: NewStudent, appUrl: string): Email {
  const name = oneLine(student.name ?? "") || "A new student";
  const level = student.level ? (LEVEL_LABELS[student.level] ?? student.level) : null;
  const course = [level, student.examYear ? `exams in summer ${student.examYear}` : null]
    .filter(Boolean)
    .join(", ");
  const link = `${appUrl.replace(/\/+$/, "")}/students/${encodeURIComponent(student.id)}`;

  const rows: [string, string][] = [];
  if (student.email) rows.push(["Email", oneLine(student.email, 320)]);
  if (course) rows.push(["Course", course]);
  if (student.subjects.length)
    rows.push(["Subjects", student.subjects.map(subjectLine).join("; ")]);
  if (student.school) rows.push(["School", oneLine(student.school, 120)]);
  if (student.provider) {
    rows.push(["Signed up with", PROVIDER_LABELS[student.provider] ?? student.provider]);
  }

  const subject = `New student: ${name}`;
  const intro = `${name} has just finished setting up their account.`;

  const text = [
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `Open their page: ${link}`,
    "",
    BRAND,
  ].join("\n");

  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c2333;max-width:560px">`,
    `<p style="margin:0 0 14px">${escapeHtml(intro)}</p>`,
    `<table style="border-collapse:collapse;margin:0 0 18px">`,
    ...rows.map(
      ([k, v]) =>
        `<tr><td style="padding:3px 16px 3px 0;color:#5b6475;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:3px 0">${escapeHtml(v)}</td></tr>`,
    ),
    `</table>`,
    `<p style="margin:0 0 14px"><a href="${escapeHtml(link)}" style="color:#1c2333;font-weight:600">Open their page</a></p>`,
    `<p style="margin:24px 0 0;color:#5b6475;font-size:13px">${BRAND}</p>`,
    `</div>`,
  ].join("");

  return { subject, text, html };
}
