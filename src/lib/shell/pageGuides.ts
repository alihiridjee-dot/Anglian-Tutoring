export type GuideStep = { target: string; title: string; body: string; selector?: string };
const at = (target: string, title: string, body: string): GuideStep => ({ target, title, body });
const select = (selector: string, title: string, body: string): GuideStep => ({
  target: "",
  selector: `[data-guide="page-content"] :is(${selector})`,
  title,
  body,
});
const filters = select(
  '[data-guide="filters"] > :first-child',
  "Make it yours",
  "Choose your subject, exam board and level to narrow the results. Select All to widen a filter again.",
);

/** Only controls present and visible when a tour starts are included. */
export const pageGuides: Record<string, GuideStep[]> = {
  MCQ: [
    select(
      "ol li > p.font-display",
      "Read the question",
      "Work through each question carefully and select the answer you think is correct.",
    ),
    select(
      "ol li button",
      "Choose your answer",
      "Select one option per question. Before submitting, you can change your selection.",
    ),
    select(
      'button[type="submit"], [data-guide="quiz-submit"]',
      "Ready to check?",
      "Submit when you’ve answered the questions. Then review the feedback and explanations to learn from any mistakes.",
    ),
  ],
  Curriculum: [
    // A student picks the subject in the header; a tutor with the filters on
    // the page. Each finds only its own, so one of the two steps shows.
    at(
      "subject-slider",
      "Choose your subject",
      "Pick the subject you want to work on here, at the top. Every page follows it, and the curriculum uses the exam board and level shown beside it.",
    ),
    select(
      '[data-guide="curriculum-filters"] > .grid',
      "Choose your subject",
      "Pick the subject you want to work on. The curriculum follows the exam board and level shown here.",
    ),
    at(
      "curriculum-search",
      "Find a specific idea",
      "Type a topic, phrase or specification code to find matching points. Select a result to open its learning resources.",
    ),
    select(
      '[data-guide="curriculum-topics"] button',
      "Explore a topic",
      "Expand a topic to reveal its specification points, then choose a point to study it.",
    ),
  ],
  "Curriculum Point": [
    select(
      "h2",
      "One idea at a time",
      "This is the specification point you selected. Read its title and description to see what you need to understand.",
    ),
    select(
      '[data-guide="point-sections"] button',
      "Learn, then practise",
      "Expand the resource sections to find the MCQ sets, videos and other materials available for this point. Counts show what has been added.",
    ),
    at(
      "curriculum-back",
      "Back to the bigger picture",
      "Use Back to Curriculum to return to your topics and choose your next point.",
    ),
  ],
  "Live Sessions": [
    at(
      "live-tabs",
      "Coming up or catching up?",
      "Upcoming shows the lessons ahead. Previous shows the ones from the last 7 days.",
    ),
    select(
      '[data-guide="live-session"] > :first-child',
      "Your lesson details",
      "Check the topic and start time here. The Join button opens 10 minutes before the lesson starts.",
    ),
  ],
  Videos: [
    filters,
    at(
      "video-watch",
      "Press play",
      "Select a video card to open the player. Read the title and description to choose the explanation you need, then close the player to return to the library.",
    ),
  ],
  Downloads: [
    filters,
    at(
      "download-file",
      "Keep a copy",
      "Use Download to open the worksheet or paper. Check the subject, board and level beside the title before you begin.",
    ),
  ],
  "Tasks & Grades": [
    select(
      '[data-guide="homework-grades"]',
      "See how you’re doing",
      "Your target grade, next to the grade your quizzes and tasks say you’re working towards, for the subject picked at the top. No target yet? Set one here.",
    ),
    select(
      '[data-guide="homework-list"] a',
      "Work through your assignments",
      "Open an assignment and answer its questions on the page. Return here for marks and feedback once your answers have been checked.",
    ),
  ],
  "Weekly MCQs": [
    at(
      "subject-slider",
      "Pick your subject",
      "Switch subjects here, at the top, to see the quizzes for the course you want to work on.",
    ),
    select(
      '[data-guide="mcq-this-week"] h2',
      "Start with this week",
      "These quizzes match the spec points in this week’s plan. Open one to answer the questions, then read the explanations.",
    ),
    select(
      '[data-guide="mcq-past"] button',
      "Revisit earlier quizzes",
      "Quizzes from earlier weeks are filed under their topic. Open a topic to retake one.",
    ),
  ],
  "My Planner": [
    at(
      "subject-slider",
      "Pick your subject",
      "Switch subjects here, at the top, to see the plan for the course you want to work on.",
    ),
    // A tutor's planner keeps its own subject toggle, beside the student's name.
    // Below `xl` the student's slider sits in the page too, so it is left out
    // by name, or a student would get this step as well as the one above.
    select(
      '[aria-label="Subject"]:not([data-guide="subject-slider"] *)',
      "Pick your subject",
      "Switch subjects to see the plan for the course you want to work on.",
    ),
    select(
      '[aria-label="Planner sections"]',
      "Your week and beyond",
      "Use these sections to move between your weekly work, the road ahead and your practice history.",
    ),
    select(
      '[aria-label="Previous week"]',
      "Look back at a week",
      "Use the week arrows to review earlier work or move forward through your plan.",
    ),
  ],
  "Student Planner": [
    select("select", "Choose a student", "Select a student to review their weekly plan and focus."),
    select(
      "h2",
      "Review their plan",
      "Use the planning controls below to review progress and adjust the student’s focus.",
    ),
  ],
  Messages: [
    at(
      "ask-question",
      "Ask for a hand",
      "Choose Ask a question to start a conversation with your tutor. Attach the topic, task or quiz you’re stuck on to give them context.",
    ),
    at(
      "message-list",
      "Choose a conversation",
      "Select a conversation here to read it and continue the discussion.",
    ),
    at(
      "message-thread",
      "Read and reply",
      "Your selected conversation appears here. Read the replies and use the message controls to continue.",
    ),
  ],
  Profile: [
    select(
      'input[placeholder="e.g. Alex Taylor"]',
      "Make yourself at home",
      "Update your display name in Account details, then save the change.",
    ),
    select(
      'input[type="file"]',
      "Add a profile photo",
      "Choose a photo using the profile photo controls.",
    ),
    select(
      'input[type="email"]',
      "Keep your details current",
      "The email section explains how to update your address. Follow any verification prompts shown.",
    ),
    select(
      'input[type="password"]',
      "Your password",
      "Use this section when you want to change your password. Complete the required fields and save when you’re ready.",
    ),
  ],
  Settings: [
    select(
      "h2",
      "Your account at a glance",
      "This section shows the email and roles associated with your account.",
    ),
  ],
  Billing: [
    select(
      "h2, h3",
      "Your plan and payments",
      "Review your current subscription here. The available controls let you manage your plan; read the details shown before confirming a change.",
    ),
    select(
      "button",
      "Manage your subscription",
      "Use the relevant billing action when you want to make a change. This tour only explains the page and never changes your subscription.",
    ),
  ],
  "Linked Parents": [
    select(
      'input[type="email"]',
      "Invite your parent or guardian",
      "Enter their email in the invitation form when you’re ready to invite them to follow your progress.",
    ),
    select(
      "h2",
      "Your family links",
      "Use the panels here to share an invite code and review pending invitations or linked parents.",
    ),
  ],
  "Linked Students": [
    select(
      'input[placeholder="ANG-XXXXXXXX"]',
      "Link a student",
      "Enter the student’s invite code here to request a link.",
    ),
    select(
      "h2",
      "Manage your links",
      "Review invitations and the students whose progress you can follow in these panels.",
    ),
  ],
  "Parent Portal": [
    select("select", "Choose a student", "Select a linked student to see their progress."),
    select(
      "h2",
      "Follow their learning",
      "Explore the progress sections below to see how your student is getting on.",
    ),
  ],
  Students: [
    select(
      "input",
      "Find a student",
      "Use the student controls to find the family or learner you want to review.",
    ),
    select(
      "h2",
      "Manage your students",
      "Choose a student to review the information and actions available for their account.",
    ),
  ],
  "Tutor Studio": [
    select(
      '[role="tablist"], nav',
      "Choose your workspace",
      "Use the studio sections to choose the resources or teaching tools you want to manage.",
    ),
    select(
      "h2",
      "Your teaching workspace",
      "The controls below belong to the selected studio section. Choose the relevant course before adding or updating materials.",
    ),
  ],
  "Revision Notes": [
    select(
      "h2, h3, p",
      "Your revision note",
      "This note covers one topic, written for your exam board. Use Back to return to the spec point you opened it from.",
    ),
  ],
};

export const pageIntroductions: Record<string, string> = {
  Curriculum:
    "Find the topics for your course, search the specification and open a point to study its resources.",
  "Curriculum Point":
    "Everything available for this specification point is collected here, so you can learn and practise in one place.",
  "Live Sessions":
    "Find upcoming classes and how to join them, and look back at the last week’s sessions.",
  Videos:
    "Find a recorded explanation for your course. Filter the library, then select a video to watch. If no videos appear, try a wider selection.",
  Downloads:
    "Find worksheets and papers for your course, then open a file to study. If nothing is listed, try a wider filter or check back after your next lesson.",
  "Tasks & Grades":
    "Complete your tasks here and return for tutor feedback and grades. New assignments appear when your tutor sets them.",
  "Weekly MCQs":
    "Start with this week’s quizzes, then revisit earlier ones by topic. A quiz appears here once your plan reaches its spec point.",
  MCQ: "Choose an answer for each question, submit the set and review the explanations. Your answers stay untouched during this tour.",
  "My Planner":
    "See what to work on this week, explore the road ahead and review your practice history.",
  "Student Planner": "Choose a student to review their weekly work and adjust their focus.",
  Messages:
    "Read and continue your conversations here. Students can start a question and attach the work they need help with.",
  Profile:
    "Make your account your own: update your photo, name and contact details, or manage your email and password.",
  Settings: "Check the email and roles associated with your signed-in account.",
  Billing: "Review your subscription and the plan-management options available to your account.",
  "Linked Parents": "Invite a parent or guardian and manage who can follow your learning progress.",
  "Linked Students": "Link a student using their invite code and review your family invitations.",
  "Parent Portal":
    "Follow your linked student’s learning progress and explore the information available for them.",
  Students: "Find and manage your students and family links from this workspace.",
  "Tutor Studio": "Your workspace for managing learning resources and teaching activities.",
  "Revision Notes": "Read the note for this topic, then go back to its spec point to practise.",
};
