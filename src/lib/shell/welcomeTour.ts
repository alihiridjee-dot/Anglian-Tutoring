import type { ComponentType } from "react";
import {
  BookMarked,
  ClipboardList,
  Compass,
  CreditCard,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Users,
  Video,
} from "lucide-react";

/**
 * The welcome tour: what Anglia Educate is, what the plan pays for, and where
 * each part of it lives.
 *
 * Written for someone who has had none of it explained. It opens with the idea
 * (live lessons with real tutors, and this site between them), then walks the
 * account's own pages in the order the week runs, so a page is only ever named
 * while it is on screen. Kept to short, plain sentences: it is read by students
 * as young as eleven.
 *
 * Every claim is what the app does today, not what the marketing pages say.
 * The tour names no number of lessons a week (the timetable is whatever the
 * tutors schedule), promises no recordings (there are none), and says homework
 * comes back marked with feedback without saying who marks it.
 *
 * Pure data, so the wording can be tested without a browser. `WelcomeTour`
 * renders it.
 */

export type WelcomeAudience = "student" | "parent";

/** One line of the "what you get" picture. */
export interface WeekRow {
  icon: ComponentType<{ className?: string }>;
  label: string;
  detail: string;
}

export interface WelcomeStep {
  /** The page the step is shown on. The tour goes there itself. */
  path: string;
  /** Selectors for the element to point at, tried in order. Empty centres the card. */
  targets: string[];
  /** The label above the title. */
  chapter: string;
  /** The page's sidebar icon, so the step also teaches where to find it. */
  icon?: ComponentType<{ className?: string }>;
  title: string;
  /** Short paragraphs. */
  body: string[];
  /** A picture under the words: the student's course, or the parts of the plan. */
  visual?: "course" | "week";
  week?: WeekRow[];
}

/** What the tour knows about the person taking it. */
export interface WelcomeFacts {
  /** First name, or null when the profile has none. */
  name: string | null;
  /** A parent's linked children, by first name. */
  children: string[];
}

/** Fired on the window by "Show me around" on a home page. */
export const WELCOME_TOUR_START = "welcome-tour:start";

export function startWelcomeTour() {
  window.dispatchEvent(new Event(WELCOME_TOUR_START));
}

/** Where each audience's tour starts and ends. */
export function welcomeHome(audience: WelcomeAudience) {
  return audience === "parent" ? "/parent-dashboard" : "/student-dashboard";
}

/** "Sam Taylor" → "Sam". Null for a blank or missing name. */
export function firstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

const greet = (name: string | null) =>
  name ? `Welcome to Anglia Educate, ${name}!` : "Welcome to Anglia Educate!";

const allSet = (name: string | null) => (name ? `You’re all set, ${name}!` : "You’re all set!");

function studentSteps({ name }: WelcomeFacts): WelcomeStep[] {
  const home = welcomeHome("student");
  return [
    {
      path: home,
      targets: [],
      chapter: "Welcome",
      title: greet(name),
      body: [
        "This is your science tutoring. Real tutors teach you in live lessons every week.",
        "Between lessons, this site shows you what to study next and checks how you’re getting on. This is the course you’re on:",
      ],
      visual: "course",
    },
    {
      path: home,
      targets: [],
      chapter: "What your plan includes",
      title: "What you get",
      body: ["Five things that work together:"],
      visual: "week",
      week: [
        { icon: Video, label: "Live lessons", detail: "On Zoom, taught by our tutors." },
        {
          icon: Compass,
          label: "A weekly plan",
          detail: "What to study each week, all the way to your exams.",
        },
        {
          icon: ListChecks,
          label: "Practice quizzes",
          detail: "They mark themselves and explain every answer.",
        },
        {
          icon: ClipboardList,
          label: "Homework",
          detail: "Answer it on the page. It comes back marked, with feedback.",
        },
        {
          icon: MessagesSquare,
          label: "Help when you’re stuck",
          detail: "Message a tutor about anything.",
        },
      ],
    },
    {
      path: home,
      targets: ['[data-guide="week-plan"]', '[data-tour="welcome"]'],
      chapter: "Dashboard",
      icon: LayoutDashboard,
      title: "Start here every time",
      body: [
        "Your dashboard shows this week’s work and your next live lesson. Open it whenever you sit down to study.",
      ],
    },
    {
      path: "/live",
      targets: ['[data-guide="live-list"]', '[data-guide="live-tabs"]'],
      chapter: "Live Sessions",
      icon: Video,
      title: "Your live lessons",
      body: [
        "This is your timetable. Each lesson shows the topics it will cover.",
        "The Join button opens 10 minutes before each lesson starts.",
      ],
    },
    {
      path: "/planner",
      targets: ['[data-guide="planner-week"]', '[aria-label="Planner sections"]'],
      chapter: "Planner",
      icon: Compass,
      title: "Your plan for the week",
      body: [
        "Your plan covers your whole course, a few points each week, so you finish in time for your exams.",
        "Anything that doesn’t stick comes back later for revision. Your quiz and homework marks decide when.",
      ],
    },
    {
      path: "/curriculum",
      targets: ['[data-guide="curriculum-topics"]', '[data-guide="curriculum-search"]'],
      chapter: "Curriculum",
      icon: BookMarked,
      title: "Everything on your course",
      body: [
        "Every topic you need to know is here. Open a topic, then a point, to find its videos, quizzes and homework.",
      ],
    },
    {
      path: "/mcqs",
      targets: ['[data-guide="mcq-this-week"]', '[data-guide="page-content"] .pop-card'],
      chapter: "MCQs",
      icon: ListChecks,
      title: "Quick quizzes",
      body: [
        "Each week there’s a short quiz for every point in your plan. It marks itself the moment you submit, and explains every answer.",
      ],
    },
    {
      path: "/homework",
      targets: [
        '[data-guide="homework-list"]',
        '[data-guide="homework-grades"]',
        '[data-guide="page-content"] .pop-card',
      ],
      chapter: "Homework & Grades",
      icon: ClipboardList,
      title: "Homework and grades",
      body: [
        "Answer your homework right here on the page. It comes back with a mark and written feedback.",
        "Once you’ve done a few, your quiz and homework results add up to a predicted grade for each subject.",
      ],
    },
    {
      path: "/messages",
      targets: ['[data-guide="ask-question"]'],
      chapter: "Messages",
      icon: MessagesSquare,
      title: "Stuck? Ask a tutor",
      body: [
        "Press Ask a question to message a tutor. Add the topic, homework or quiz you’re stuck on, so they see exactly what you mean.",
      ],
    },
    {
      path: "/parents",
      targets: ['[data-guide="invite-parent"]'],
      chapter: "Linked Parents",
      icon: Users,
      title: "Bring a parent along",
      body: [
        "A parent or guardian can follow your progress. Invite them here, or give them the invite code on this page.",
        "They see your grades, homework and plan, but never your messages.",
      ],
    },
    {
      path: home,
      targets: [],
      chapter: "All set",
      title: allSet(name),
      body: [
        "Start with this week’s plan on your dashboard.",
        "Want this tour again? Press Show me around at the top of your dashboard.",
      ],
    },
  ];
}

function parentSteps({ name, children }: WelcomeFacts): WelcomeStep[] {
  const home = welcomeHome("parent");
  const linked = children.length > 0;
  // One child is named. Two or more, or none yet, read as "your child".
  const child = children.length === 1 ? children[0] : null;
  const them = child ?? "your child";
  const They = child ?? "Your child";

  const welcome: WelcomeStep = {
    path: home,
    targets: [],
    chapter: "Welcome",
    title: greet(name),
    body: [
      `Anglia Educate is science tutoring. ${They} gets live lessons with real tutors every week.`,
      linked
        ? `Between lessons, the site gives ${them} a study plan, quizzes and marked homework. This portal lets you follow along.`
        : "Between lessons, the site gives them a study plan, quizzes and marked homework. Once you link their account, this portal lets you follow along.",
    ],
  };

  const paysFor: WelcomeStep = {
    path: home,
    targets: [],
    chapter: "What the plan includes",
    title: "What you’re paying for",
    body: [`${They} gets five things that work together:`],
    visual: "week",
    week: [
      { icon: Video, label: "Live lessons", detail: "On Zoom, taught by our tutors." },
      {
        icon: Compass,
        label: "A weekly plan",
        detail: "What to study each week, all the way to the exams.",
      },
      {
        icon: ListChecks,
        label: "Practice quizzes",
        detail: "Marked straight away, with every answer explained.",
      },
      {
        icon: ClipboardList,
        label: "Marked homework",
        detail: "Answered online, and returned with written feedback.",
      },
      {
        icon: MessagesSquare,
        label: "Help between lessons",
        detail: "They can message a tutor whenever they’re stuck.",
      },
    ],
  };

  const portal: WelcomeStep[] = linked
    ? [
        {
          path: home,
          targets: ['[data-tour="parent-grades"]', '[data-tour="parent-welcome"]'],
          chapter: "Parent Portal",
          icon: LayoutDashboard,
          title: "How they’re doing",
          body: [
            `Here’s ${them}’s predicted grade in each subject, next to their target. A prediction appears once they’ve done a few quizzes and homework.`,
            "Further down: this week’s topics, the tutor’s note and upcoming lessons.",
          ],
        },
        {
          path: home,
          targets: ['section[data-tour="parent-messages"]'],
          chapter: "Parent Portal",
          icon: MessagesSquare,
          title: "Talk to the tutors",
          body: [
            `Message a tutor here. These chats are just between you and the tutors. ${They}’s own questions stay private.`,
          ],
        },
      ]
    : [];

  const billing: WelcomeStep = {
    path: "/billing",
    targets: ['[data-guide="parent-billing"]'],
    chapter: "Billing",
    icon: CreditCard,
    title: "The plan and payments",
    body: [`See ${them}’s plan and what it costs. You can pay for it or change it here.`],
  };

  const family: WelcomeStep = {
    path: "/parents",
    targets: ['[data-guide="link-child"]'],
    chapter: "Linked Students",
    icon: Users,
    title: linked ? "Link another child" : "Link your child",
    body: [
      linked
        ? "More than one child with us? Ask each one for their invite code and enter it here."
        : "Ask your child for their invite code. It starts with ANG-. Enter it here to see their progress.",
    ],
  };

  const done: WelcomeStep = {
    path: home,
    targets: [],
    chapter: "All set",
    title: allSet(name),
    body: [
      "Check in whenever you like.",
      "Want this tour again? Press Show me around at the top of the portal.",
    ],
  };

  return linked
    ? [welcome, paysFor, ...portal, billing, family, done]
    : [welcome, paysFor, family, billing, done];
}

export function welcomeSteps(audience: WelcomeAudience, facts: WelcomeFacts): WelcomeStep[] {
  return audience === "parent" ? parentSteps(facts) : studentSteps(facts);
}
