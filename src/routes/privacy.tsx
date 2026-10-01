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

const UPDATED = "1 October 2026";
const CONTACT = "angliaeducate@gmail.com";

/**
 * Everyone who handles personal data for us. Keep this list in step with the
 * code: a new service that receives personal data belongs here before it ships.
 */
const PROCESSORS = [
  {
    name: "Supabase",
    what: "Stores accounts, learning records, messages and uploaded files, and runs sign-in.",
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
    what: "Sends our emails, such as trial codes, parent invitations and account notices.",
    where: "USA",
  },
  {
    name: "Zoom",
    what: "Runs live lessons.",
    where: "USA",
  },
  {
    name: "Anthropic",
    what: "Its AI, Claude, helps us mark homework and write feedback and progress summaries.",
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
            your tutors can teach you and mark your homework. Your parent or guardian can see your
            progress if you link your account to theirs. If you&apos;re under 13, please ask a
            parent or guardian before you sign up. If something here worries you, talk to them or
            email us.
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
            and, if you give them, your phone number, school, level, exam board and a profile photo.
            Your password is held by our sign-in provider in a form nobody can read, including us.
          </p>
          <h3>If you sign in with Google or Microsoft</h3>
          <p>
            Your name, email address and profile picture from that account. We don&apos;t receive
            your password, and we can&apos;t see your email, files or contacts.
          </p>
          <h3>Learning records</h3>
          <p>
            Subjects and exam boards, previous, current and target grades, homework answers and
            uploaded work, quiz answers and scores, how confident you feel about each topic, weekly
            plans, and the marks, feedback and notes tutors write about your progress.
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
            If you use our contact form: your name, email address, phone number if you give it, and
            your message. If you ask for a free-trial code: your email address.
          </p>
          <h3>Your browser</h3>
          <p>
            We use your browser&apos;s own storage to keep you signed in and to remember small
            things, like a trial code you&apos;ve been sent. We don&apos;t use advertising or
            tracking cookies. Vercel counts page visits without cookies and without identifying you.
          </p>
        </Section>

        <Section title="How we use it, and why we're allowed to">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>To teach:</strong> lessons, homework, marking, feedback, plans and progress
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
          <p>
            We use Claude, an AI made by Anthropic, to help mark homework and to draft feedback and
            progress summaries. It receives the questions and the student&apos;s answers. Anthropic
            does not use information sent through its business service to train its AI. Tutors stay
            responsible for students&apos; marks and feedback.
          </p>
        </Section>

        <Section title="Who can see it">
          <p>
            Inside Anglia Educate, a student&apos;s work and records can be seen by our tutors and
            by parents or guardians the student has linked to. A parent can only ever see their own
            linked children.
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
            If you message us on WhatsApp, WhatsApp handles that conversation under its own privacy
            policy. We&apos;d share information with anyone else only if the law required it.
          </p>
        </Section>

        <Section title="Data stored outside the UK">
          <p>
            Our main database is in the EU, which UK law treats as protecting data to the same
            standard. Some of the services above are based in the USA. When data goes there, we rely
            on the protections UK law requires, such as the UK&apos;s approved contract terms or the
            UK–US data bridge.
          </p>
        </Section>

        <Section title="How long we keep it">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Accounts and learning records:</strong> for as long as the account is open.
            </li>
            <li>
              <strong>Deleted accounts:</strong> there&apos;s a 7-day window to change your mind,
              then the account and its records are permanently deleted.
            </li>
            <li>
              <strong>Payment records:</strong> six years, because UK tax law requires it.
            </li>
            <li>
              <strong>Enquiries:</strong> until we no longer need them to reply and follow up, or
              sooner if you ask.
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
