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
    select(
      '[data-guide="curriculum-filters"] > :first-child',
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
    filters,
    at(
      "live-tabs",
      "Coming up or catching up?",
      "Upcoming shows the lessons ahead. Previous lets you look back at past sessions and any recording links provided.",
    ),
    select(
      '[data-guide="live-session"] > :first-child',
      "Your lesson details",
      "Check the topic and start time here. Use the joining link when available; past sessions may include a recording to watch.",
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
  "Homework & Grades": [
    select(
      '[data-guide="homework-grades"] h3',
      "See how you’re doing",
      "Your predicted grades and practice averages appear here when enough results are available. Use them to spot subjects that need more attention.",
    ),
    select(
      '[data-guide="homework-list"] button',
      "Work through your assignments",
      "Open an assignment and answer its questions on the page. Return here for marks and feedback once your answers have been checked.",
    ),
  ],
  "Weekly MCQs": [
    select(
      '[data-guide="mcq-weekly"] h3',
      "Start with this week",
      "These are your current weekly quizzes. Select a set to answer the questions and review the explanations.",
    ),
    select(
      '[data-guide="mcq-topical"] h3',
      "Practise a topic",
      "These assessments are grouped by course. Pick a set for the topic you want to check.",
    ),
    at(
      "mcq-past",
      "Revisit previous quizzes",
      "Expand Completed / past MCQs to find older sets and practise again.",
    ),
  ],
  "My Planner": [
    select(
      '[aria-label="Subject"]',
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
      "Choose Ask a question to start a conversation with your tutor. Attach the topic, homework or quiz you’re stuck on to give them context.",
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
      "Your revision notes",
      "Read the information here for the current availability of revision notes. You can also explore the resources attached to individual curriculum points.",
    ),
  ],
};

export const pageIntroductions: Record<string, string> = {
  Curriculum:
    "Find the topics for your course, search the specification and open a point to study its resources.",
  "Curriculum Point":
    "Everything available for this specification point is collected here, so you can learn and practise in one place.",
  "Live Sessions":
    "Find upcoming classes, check joining details and look back at previous sessions. If a recording is available, you can catch up here.",
  Videos:
    "Find a recorded explanation for your course. Filter the library, then select a video to watch. If no videos appear, try a wider selection.",
  Downloads:
    "Find worksheets and papers for your course, then open a file to study. If nothing is listed, try a wider filter or check back after your next lesson.",
  "Homework & Grades":
    "Complete your homework here and return for tutor feedback and grades. New assignments appear when your tutor sets them.",
  "Weekly MCQs":
    "Choose a weekly quiz or a topic assessment to check your understanding. Quizzes appear here once they’ve been made available for your subjects.",
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
  "Revision Notes":
    "Personal notes are coming soon. For now, your dashboard brings together your week’s videos, quizzes and homework.",
};
