import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { Nav } from "@/components/landing/Nav";
import { Footer } from "@/components/landing/Footer";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy policy — Anglia Educate" },
      {
        name: "description",
        content:
          "What information Anglia Educate collects about students, parents and visitors, why, who it's shared with, how long it's kept, and your rights.",
      },
    ],
  }),
  component: PrivacyPage,
});

const UPDATED = "7 October 2026";
const CONTACT = "angliaeducate@gmail.com";

/**
 * Everyone who handles personal data for us. Keep this list in step with the
 * code: a new service that receives personal data belongs here before it ships.
 */
const PROCESSORS = [
  {
    name: "Supabase",
    what: "Stores accounts, learning records, messages and profile photos, runs sign-in, and sends sign-up codes and password-reset emails.",
    where: "EU (Frankfurt)",
  },
  {
    name: "Vercel",
    what: "Hosts the website and counts page visits, without cookies.",
    where: "USA",
  },
  {
    name: "Stripe",
    what: "Takes payments and manages subscriptions. We never see card details.",
    where: "USA / Ireland",
  },
  {
    name: "Resend",
    what: "Sends free-trial codes and account-deletion notices.",
    where: "USA",
  },
  {
    name: "Zoom",
    what: "Runs live lessons. We send it only each lesson's title and time.",
    where: "USA",
  },
  {
    name: "Anthropic",
    what: "Its AI, Claude, helps with marking and feedback, as described under AI marking.",
    where: "USA",
  },
  {
    name: "DeepSeek",
    what: "Its AI reads a question a student chooses to send with “Ask for help” in the search box, and the names of the topics a student found hardest, to suggest questions for their tutor. Both are described under AI help from DeepSeek.",
    where: "China",
  },
  {
    name: "YouTube and Vimeo",
    what: "Play lesson videos. They may set their own cookies when you press play.",
    where: "USA",
  },
  {
    name: "Meta (WhatsApp)",
    what: "Only if you message us on WhatsApp or use the chat on our demo pages.",
    where: "USA",
  },
  {
    name: "Google and Microsoft",
    what: "Only if you choose to sign in with them.",
    where: "USA",
  },
  {
    name: "Google Fonts",
    what: "Provides the website's fonts, so it sees your device's internet address.",
    where: "USA",
  },
];

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-secondary/40 text-foreground font-sans antialiased">
      <Nav />

      <section className="page-aurora relative overflow-hidden border-b border-border">
        <div className="relative mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <span className="sticker">
            <ShieldCheck className="size-3.5" aria-hidden /> Privacy
          </span>
          <h1 className="text-foreground mt-6 text-4xl leading-[1.1] font-extrabold tracking-tight sm:text-5xl">
            Your privacy
          </h1>
          <p className="mt-5 text-lg leading-relaxed">
            Most of the people who use Anglia Educate are children, so we keep this simple and we
            collect only what we need to teach.
          </p>
          <p className="mt-4">
            <span className="chip">Last updated {UPDATED}</span>
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-12 sm:px-6 sm:py-16">
        <div className="premium-card tint-emerald rounded-3xl p-6 sm:p-8">
          <span className="eyebrow">The short version</span>
          <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed">
            <li>
              We use your information to teach, mark work, keep parents informed and take payment.
            </li>
            <li>We never sell it, never show adverts and never use advertising cookies.</li>
            <li>Only your tutors, and parents you link to, can see a student&apos;s work.</li>
            <li>We share data only with the services that run the platform, listed below.</li>
            <li>
              You can ask to see, correct or delete your information at any time by emailing{" "}
              <a className="font-semibold underline" href={`mailto:${CONTACT}`}>
                {CONTACT}
              </a>
              .
            </li>
          </ul>
        </div>

        <div className="premium-card tint-pop rounded-3xl p-6 sm:p-8">
          <span className="eyebrow">If you&apos;re a student</span>
          <p className="mt-4 leading-relaxed">
            We keep your name, email address, school, grades and the work you do on the site, so
            your tutors can teach you and mark your tasks. An AI helps with marking, and your tutors
            can check and change its marks. Your parent or guardian can see your progress if you
            link your account to theirs. If you&apos;re under 13, please ask a parent or guardian
            before you sign up. If something here worries you, talk to them or email us.
          </p>
          <p className="mt-3 leading-relaxed">
            If you press <strong>Ask for help</strong> in the search box, what you typed is sent to
            an AI company in China. So don&apos;t type your name or anything personal there.
          </p>
        </div>

        <Section title="Who we are">
          <p>
            Anglia Educate is an online tutoring service run by Ali and Nadia, based in London
            (NW7), United Kingdom. It is not a limited company. We decide how your information is
            used, which makes us its &quot;data controller&quot; under UK data protection law.
          </p>
          <p>
            Questions about this policy or your information go to{" "}
            <a className="font-semibold underline" href={`mailto:${CONTACT}`}>
              {CONTACT}
            </a>
            .
          </p>
        </Section>

        <Section title="What we collect">
          <h3>Your account</h3>
          <p>
            Your name, email address and password, whether you&apos;re a student, parent or tutor,
            and, if you give them, your phone number, school, level, exam board, exam year and a
            profile photo. Your password is held by our sign-in provider in a form nobody can read,
            including us.
          </p>
          <h3>If you sign in with Google or Microsoft</h3>
          <p>
            Your name, email address and profile picture from that account. We don&apos;t receive
            your password, and we can&apos;t see your email, files or contacts.
          </p>
          <h3>Learning records</h3>
          <p>
            Subjects and exam boards, previous, current and target grades, how you rate your own
            study skills, task answers, quiz answers and scores, how confident you feel about each
            topic, weekly plans and the reflections you write in weekly check-ins, and the marks,
            feedback and notes tutors write about your progress.
          </p>
          <h3>Messages</h3>
          <p>Messages between parents and tutors sent through the site.</p>
          <h3>Payments</h3>
          <p>
            Which plan you&apos;re on and whether it&apos;s active. Card details go straight to
            Stripe; we never see or store them.
          </p>
          <h3>Enquiries</h3>
          <p>
            If you use our contact form or the chat on our demo pages: your name, email address,
            phone number if you give it, and your message. If you ask for a free-trial code: your
            email address, so we can send it. We keep only a scrambled copy of that address, which
            can&apos;t be turned back into it.
          </p>
          <h3>Your browser</h3>
          <p>
            We use your browser&apos;s own storage to keep you signed in, to save task answers you
            haven&apos;t sent yet, and to remember small things, like a trial code you&apos;ve been
            sent. Anglia Educate sets no cookies. Lesson videos from YouTube and Vimeo, and
            Stripe&apos;s payment pages, may set their own. Vercel counts page visits without
            cookies.
          </p>
        </Section>

        <Section title="How we use it, and why we're allowed to">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>To teach:</strong> lessons, tasks, marking, feedback, plans and progress
              reports. This is the service you or your parent signed up for (a contract).
            </li>
            <li>
              <strong>To keep parents informed:</strong> a linked parent sees their child&apos;s
              progress and can message tutors (a contract).
            </li>
            <li>
              <strong>To take payment and keep records:</strong> (a contract, and the law, which
              requires us to keep financial records).
            </li>
            <li>
              <strong>To answer enquiries and send trial codes you ask for:</strong> (our legitimate
              interest in replying to you).
            </li>
            <li>
              <strong>To keep the site secure and working:</strong> for example, limiting repeated
              attempts and fixing faults (our legitimate interest in running a safe service).
            </li>
          </ul>
          <p>We don&apos;t use your information for advertising, and we don&apos;t sell it.</p>
        </Section>

        <Section title="AI marking">
          <p>We use Claude, an AI made by Anthropic, in three places:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Tasks:</strong> it receives the questions, the mark scheme and the
              student&apos;s answers, but not their name or email, and suggests marks and feedback.
              A tutor can check and change them. If no tutor has reviewed them within 30 minutes,
              the suggested marks are released to the student automatically. Students and parents
              can always ask a tutor to look again.
            </li>
            <li>
              <strong>Weekly feedback:</strong> it receives the student&apos;s recent scores and the
              reflection they write in their weekly check-in.
            </li>
            <li>
              <strong>Message drafts:</strong> a tutor can ask it to draft a reply to a student. It
              sees the student&apos;s name and the recent messages in that conversation, and the
              tutor edits and sends the reply.
            </li>
          </ul>
          <p>
            Anthropic does not use information sent through its business service to train its AI.
          </p>
        </Section>

        <Section title="AI help from DeepSeek">
          <p>
            Students can type a question into the search box, such as &quot;where&apos;s my quiz for
            this week?&quot;. Most questions are answered by the site itself, and nothing leaves it.
          </p>
          <p>
            If the site can&apos;t work a question out, the student can choose{" "}
            <strong>Ask for help</strong>. Only then is the question they typed sent to DeepSeek, an
            AI company based in China, which picks the page that answers it. We remove email
            addresses and phone numbers first, and send nothing else: no name, account, marks or
            work.
          </p>
          <p>
            When a student starts a question to our tutors, the site suggests questions about the
            topics they found hardest. To write them, DeepSeek is sent the names of up to three
            topics from the exam board&apos;s syllabus, such as &quot;Osmosis&quot;. The site picks
            the topics from the student&apos;s marks, but sends no marks, name, account or work.
          </p>
          <p>
            DeepSeek stores what it receives in China and may use it to improve its AI. That&apos;s
            why students shouldn&apos;t type their name or anything personal into the search box.
          </p>
        </Section>

        <Section title="Who can see it">
          <p>
            Inside Anglia Educate, a student&apos;s work and records can be seen by our tutors and
            by parents or guardians the student has linked to by sharing their invite code. A parent
            can only ever see their own linked children. Private notes tutors keep about a student
            are seen only by tutors.
          </p>
          <p>Outside it, these services handle data for us, only to run the platform:</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {PROCESSORS.map((p) => (
              <div key={p.name} className="premium-card tint-slate rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="!mt-0 text-base">{p.name}</h3>
                  <span className="chip">{p.where}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed">{p.what}</p>
              </div>
            ))}
          </div>
          <p>
            WhatsApp, YouTube and Vimeo also handle what you do with them under their own privacy
            policies. We&apos;d share information with anyone else only if the law required it.
          </p>
        </Section>

        <Section title="Data stored outside the UK">
          <p>
            Our main database is in the EU, which UK law treats as protecting data to the same
            standard. Some of the services above are based in the USA. When data goes there, we rely
            on the protections UK law requires, such as the UK&apos;s approved contract terms or the
            UK–US data bridge.
          </p>
          <p>
            DeepSeek is based in China, which UK law does not treat as protecting data to the same
            standard. That&apos;s why it receives so little: only a question a student types and
            chooses to send, with email addresses and phone numbers removed, and the names of
            syllabus topics.
          </p>
        </Section>

        <Section title="How long we keep it">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Accounts:</strong> for as long as the account is open.
            </li>
            <li>
              <strong>Learning records</strong> (plans, quiz and task results, marks, revision
              history and tutor notes): kept while a plan is active or paused. Pausing, or a payment
              that hasn&apos;t gone through, never deletes anything. If a plan is cancelled,
              they&apos;re permanently deleted 7 days after it ends, and removing a subject does the
              same for that subject. Coming back within the 7 days keeps everything.
            </li>
            <li>
              <strong>Deleting an account:</strong> email us to ask. There&apos;s then a 7-day
              window to change your mind, after which the account and its records are permanently
              deleted.
            </li>
            <li>
              <strong>Cleared automatically:</strong> unsent task drafts after 30 days,
              conversations 30 days after the last message once a tutor has replied, and records of
              past live lessons after 7 days.
            </li>
            <li>
              <strong>Payment records:</strong> Stripe keeps its record of past payments, and we
              keep financial records for six years, as UK tax law requires.
            </li>
            <li>
              <strong>Enquiries:</strong> we keep these so we can follow up. Ask and we&apos;ll
              delete yours.
            </li>
          </ul>
        </Section>

        <Section title="Your rights">
          <p>You can ask us to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>give you a copy of your information</li>
            <li>correct anything that&apos;s wrong</li>
            <li>delete your information</li>
            <li>stop or limit how we use it, or object to it</li>
            <li>send your information to you or another service in a usable format</li>
          </ul>
          <p>
            Email{" "}
            <a className="font-semibold underline" href={`mailto:${CONTACT}`}>
              {CONTACT}
            </a>{" "}
            and we&apos;ll reply within one month. A parent or guardian can make these requests for
            a child. If you&apos;re unhappy with how we&apos;ve handled your information, you can
            complain to the Information Commissioner&apos;s Office at{" "}
            <a className="font-semibold underline" href="https://ico.org.uk/make-a-complaint/">
              ico.org.uk
            </a>{" "}
            or on 0303 123 1113. We&apos;d appreciate the chance to put things right first.
          </p>
        </Section>

        <Section title="The school list">
          <p>
            When you type your school, we suggest names from the UK&apos;s official lists of
            schools. The list is downloaded to your device and searched there, so nothing you type
            is sent anywhere until you save it.
          </p>
          <p>
            It contains public sector information from the Department for Education, the Welsh
            Government, the Scottish Government and the Department of Education (Northern Ireland),
            licensed under the{" "}
            <a
              className="font-semibold underline"
              href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
            >
              Open Government Licence v3.0
            </a>
            .
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we change how we use your information, we&apos;ll update this page and the date at
            the top. For a significant change, we&apos;ll tell account holders by email.
          </p>
        </Section>
      </main>

      <Footer />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="premium-card rounded-3xl p-6 sm:p-8">
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-bold">
        {children}
      </div>
    </section>
  );
}
