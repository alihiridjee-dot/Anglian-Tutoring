import type { ComponentType } from "react";
import {
  BookMarked,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Compass,
  CreditCard,
  History,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Repeat,
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

/** One line of the "what you get" picture: an emoji in a dot of its page's colour. */
export interface WeekRow {
  emoji: string;
  /** The `tint-*` class of the page it lives on, as the sidebar colours it. */
  tint: string;
  label: string;
  detail: string;
}

export interface WelcomeStep {
  /** The page the step is shown on. The tour goes there itself. */
  path: string;
  /**
   * Selectors for the element to ring on the page, tried in order. Empty puts
   * the card in the middle of the screen, for a step that explains an idea.
   */
  targets: string[];
  /**
   * The step's page, read out with the tour's trail. Steps in a row with the
   * same chapter are one page's parts: the first is the page's stop on the
   * trail and the rest are small stops beside it.
   */
  chapter: string;
  /** The step's stop on the trail. */
  emoji: string;
  /** The step's colour: its page's, as the sidebar colours it. */
  tint: string;
  /** The page's sidebar icon, so the step also teaches where to find it. */
  icon?: ComponentType<{ className?: string }>;
  title: string;
  /** Short paragraphs. */
  body: string[];
  /** A picture under the words: the student's course, or the parts of the plan. */
  visual?: "course" | "week";
  week?: WeekRow[];
  /**
   * Moved on from by tapping what the step rings, not by Next. `label` names
   * it as the page does ("Tap Exams"). The tap is the tour's, so it changes
   * nothing on the page: the step's words show once it lands. With `open`, the
   * tour then presses it for real (a tab) and goes straight on to the next
   * step, so the words show from the start.
   */
  tap?: { label: string; open?: boolean };
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
      emoji: "👋",
      tint: "tint-primary",
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
      emoji: "🎁",
      tint: "tint-pop",
      title: "What you get",
      body: ["Five things that work together:"],
      visual: "week",
      week: [
        {
          emoji: "🎥",
          tint: "tint-chem",
          label: "Live lessons",
          detail: "On Zoom, taught by our tutors.",
        },
        {
          emoji: "🧭",
          tint: "tint-amber",
          label: "A weekly plan",
          detail: "What to study each week, all the way to your exams.",
        },
        {
          emoji: "✅",
          tint: "tint-accent",
          label: "Practice quizzes",
          detail: "They mark themselves and explain every answer.",
        },
        {
          emoji: "📝",
          tint: "tint-rose",
          label: "Tasks",
          detail: "Answer it on the page. It comes back marked, with feedback.",
        },
        {
          emoji: "💬",
          tint: "tint-phys",
          label: "Help when you’re stuck",
          detail: "Message a tutor about anything.",
        },
      ],
    },
    {
      path: home,
      targets: ['[data-guide="week-plan"]', '[data-tour="welcome"]'],
      chapter: "Dashboard",
      emoji: "🏠",
      tint: "tint-primary",
      icon: LayoutDashboard,
      title: "Start here every time",
      body: [
        "Your dashboard shows this week’s work. Open it whenever you sit down to study.",
        "This week’s points come in three boxes. Here’s what each one is for.",
      ],
    },
    // The three boxes of the week, one at a time, each saying why its points
    // are there; then the list that holds all of them.
    {
      path: home,
      targets: ['[data-guide="lane-new"]', '[data-guide="week-plan"]'],
      chapter: "Dashboard",
      emoji: "🌱",
      tint: "tint-primary",
      icon: CircleDot,
      title: "New learning",
      body: [
        "The next topic on your course. Your plan spreads the whole course over the weeks before your exams, so this is where you’re up to.",
      ],
    },
    {
      path: home,
      targets: ['[data-guide="lane-returning"]', '[data-guide="week-plan"]'],
      chapter: "Dashboard",
      emoji: "🪃",
      tint: "tint-amber",
      icon: History,
      title: "Missed work returning",
      body: [
        "Points from earlier weeks that aren’t finished yet. They come back a few at a time, so you catch up before your exams without one huge week.",
        "When a topic is here, press its ⓘ to see the week it was first planned for.",
      ],
    },
    {
      path: home,
      targets: ['[data-guide="lane-revision"]', '[data-guide="week-plan"]'],
      chapter: "Dashboard",
      emoji: "🧠",
      tint: "tint-rose",
      icon: Repeat,
      title: "Revision",
      body: [
        "Points you’ve already done a quiz or task on come back, so you don’t forget them.",
        "Your marks decide when. A low mark brings a point back sooner, a high mark later, and never within a week.",
      ],
    },
    {
      path: home,
      targets: ["#weekly-task-list", '[data-guide="week-plan"]'],
      chapter: "Dashboard",
      emoji: "📋",
      tint: "tint-primary",
      icon: ListChecks,
      title: "Your weekly task list",
      body: [
        "All the points from the three boxes, together in one list. This is everything to work through this week.",
        "Each row has the point’s video, notes, quiz and task. A point ticks itself off once its quiz and task are in.",
      ],
    },
    // The planner's three tiles, each tapped before it's explained. The tour
    // catches the taps, so none of them moves the exam date or leaves the page.
    {
      path: "/planner",
      targets: ['[data-guide="planner-tab-plan"]'],
      chapter: "Planner",
      emoji: "🧭",
      tint: "tint-amber",
      icon: Compass,
      title: "Your whole plan",
      body: ["Your planner maps out your whole course, week by week, all the way to your exams."],
      tap: { label: "Full plan", open: true },
    },
    {
      path: "/planner",
      targets: ['[data-guide="plan-exams"]'],
      chapter: "Planner",
      emoji: "📅",
      tint: "tint-primary",
      icon: CalendarDays,
      title: "Your exam date",
      body: [
        "Your plan is paced to finish before this date. The number is how many weeks you have left.",
        "If the date is wrong, change it here and your weeks move to fit.",
      ],
      tap: { label: "Exams" },
    },
    {
      path: "/planner",
      targets: ['[data-guide="plan-covered"]'],
      chapter: "Planner",
      emoji: "🧩",
      tint: "tint-emerald",
      icon: CheckCircle2,
      title: "Topics covered",
      body: [
        "A topic counts as covered once every point in it has a quiz or task mark of 70% or more.",
        "Reorder topics lets you put your topics in the order your school teaches them.",
      ],
      tap: { label: "Topics covered" },
    },
    {
      path: "/planner",
      targets: ['[data-guide="plan-catch-up"]'],
      chapter: "Planner",
      emoji: "🪃",
      tint: "tint-amber",
      icon: History,
      title: "Points to catch up",
      body: [
        "Points from earlier weeks that aren’t finished yet. They come back to your dashboard a few a week, under Missed work returning.",
        "Finish them and this number goes down.",
      ],
      tap: { label: "To catch up" },
    },
    {
      path: "/live",
      targets: ['[data-guide="live-list"]', '[data-guide="live-tabs"]'],
      chapter: "Live Sessions",
      emoji: "🎥",
      tint: "tint-chem",
      icon: Video,
      title: "Your live lessons",
      body: [
        "This is your timetable. Each lesson shows the topics it will cover.",
        "The Join button opens 10 minutes before each lesson starts.",
      ],
    },
    {
      path: "/curriculum",
      targets: ['[data-guide="curriculum-topics"]', '[data-guide="curriculum-search"]'],
      chapter: "Curriculum",
      emoji: "📚",
      tint: "tint-emerald",
      icon: BookMarked,
      title: "Everything on your course",
      body: [
        "Every topic you need to know is here. Open a topic, then a point, to find its videos, quizzes and tasks.",
      ],
    },
    {
      path: "/mcqs",
      targets: ['[data-guide="mcq-list"]', '[data-guide="page-content"] .pop-card'],
      chapter: "MCQs",
      emoji: "✅",
      tint: "tint-accent",
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
      chapter: "Tasks & Grades",
      emoji: "📝",
      tint: "tint-rose",
      icon: ClipboardList,
      title: "Tasks and grades",
      body: [
        "Answer your tasks right here on the page. Each comes back with a mark and written feedback.",
        "Once you’ve done a few, your quiz and task results add up to a predicted grade for each subject.",
      ],
    },
    {
      path: "/messages",
      targets: ['[data-guide="ask-question"]'],
      chapter: "Messages",
      emoji: "💬",
      tint: "tint-phys",
      icon: MessagesSquare,
      title: "Stuck? Ask a tutor",
      body: [
        "Press Ask a question to message a tutor. Add the topic, task or quiz you’re stuck on, so they see exactly what you mean.",
      ],
    },
    {
      path: "/parents",
      targets: ['[data-guide="invite-parent"]'],
      chapter: "Linked Parents",
      emoji: "👪",
      tint: "tint-slate",
      icon: Users,
      title: "Bring a parent along",
      body: [
        "A parent or guardian can follow your progress. Invite them here, or give them the invite code on this page.",
        "They see your grades, tasks and plan, but never your messages.",
      ],
    },
    {
      path: home,
      targets: ['[data-guide="guide"]'],
      chapter: "All set",
      emoji: "🎉",
      tint: "tint-primary",
      title: allSet(name),
      body: [
        "Start with this week’s plan on your dashboard.",
        "Want to know more about any page? Press the 🧭 at the top. Here on your dashboard, it plays the video and this tour again.",
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
    emoji: "👋",
    tint: "tint-primary",
    title: greet(name),
    body: [
      `Anglia Educate is science tutoring. ${They} gets live lessons with real tutors every week.`,
      linked
        ? `Between lessons, the site gives ${them} a study plan, quizzes and marked tasks. This portal lets you follow along.`
        : "Between lessons, the site gives them a study plan, quizzes and marked tasks. Once you link their account, this portal lets you follow along.",
    ],
  };

  const paysFor: WelcomeStep = {
    path: home,
    targets: [],
    chapter: "What the plan includes",
    emoji: "🎁",
    tint: "tint-pop",
    title: "What you’re paying for",
    body: [`${They} gets five things that work together:`],
    visual: "week",
    week: [
      {
        emoji: "🎥",
        tint: "tint-chem",
        label: "Live lessons",
        detail: "On Zoom, taught by our tutors.",
      },
      {
        emoji: "🧭",
        tint: "tint-amber",
        label: "A weekly plan",
        detail: "What to study each week, all the way to the exams.",
      },
      {
        emoji: "✅",
        tint: "tint-accent",
        label: "Practice quizzes",
        detail: "Marked straight away, with every answer explained.",
      },
      {
        emoji: "📝",
        tint: "tint-rose",
        label: "Marked tasks",
        detail: "Answered online, and returned with written feedback.",
      },
      {
        emoji: "💬",
        tint: "tint-phys",
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
          emoji: "📈",
          tint: "tint-primary",
          icon: LayoutDashboard,
          title: "How they’re doing",
          body: [
            `Here’s ${them}’s predicted grade in each subject, next to their target. A prediction appears once they’ve done a few quizzes and tasks.`,
            "Further down: this week’s topics, the tutor’s note and upcoming lessons.",
          ],
        },
        {
          path: home,
          targets: ['section[data-tour="parent-messages"]'],
          chapter: "Parent Portal",
          emoji: "💬",
          tint: "tint-phys",
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
    emoji: "💳",
    tint: "tint-emerald",
    icon: CreditCard,
    title: "The plan and payments",
    body: [`See ${them}’s plan and what it costs. You can pay for it or change it here.`],
  };

  const family: WelcomeStep = {
    path: "/parents",
    targets: ['[data-guide="link-child"]'],
    chapter: "Linked Students",
    emoji: "🔗",
    tint: "tint-slate",
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
    targets: ['[data-guide="guide"]'],
    chapter: "All set",
    emoji: "🎉",
    tint: "tint-primary",
    title: allSet(name),
    body: [
      "Check in whenever you like.",
      "Want to know more about any page? Press the 🧭 at the top. Here on the portal, it plays this tour again.",
    ],
  };

  return linked
    ? [welcome, paysFor, ...portal, billing, family, done]
    : [welcome, paysFor, family, billing, done];
}

export function welcomeSteps(audience: WelcomeAudience, facts: WelcomeFacts): WelcomeStep[] {
  return audience === "parent" ? parentSteps(facts) : studentSteps(facts);
}
