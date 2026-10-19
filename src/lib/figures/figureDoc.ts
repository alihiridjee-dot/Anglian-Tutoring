/**
 * docs/prompts/deepseek-figure-prompt.md, printed from the prompt's own
 * code so the document and what is sent never differ (figurePrompt.test.ts).
 */
import {
  FIGURE_ENDPOINT,
  FIGURE_EXAMPLES,
  FIGURE_PRICE,
  FIGURE_PROMPT,
  FIGURE_REQUEST,
  figureMessages,
  retryMessage,
} from "./figurePrompt";

export function figurePromptDoc(): string {
  const [user] = figureMessages(FIGURE_EXAMPLES[0].request).slice(1);
  const retry = retryMessage(["The point (6, 20) is not where its values put it"]);
  return `# DeepSeek figure prompt

<!-- Printed from src/lib/figures/figurePrompt.ts by \`bun scripts/figure-trial.ts doc\`. Don't edit it by hand: a test keeps the two the same. -->

DeepSeek draws the one picture a question needs: a line graph, a scatter graph, a bar chart, a circuit, a reaction profile or a food web. It works from a **brief** that holds every value, label and connection, so it draws and never decides. Keys, lists and tables are not pictures: it answers \`not_needed\`, and the site lays them out as text and tables. Realistic drawings (cells, organs, apparatus) are answered \`cannot_draw\`.

Every picture goes through the checker (\`src/lib/figures/figureCheck.ts\`) before any student can see it:
- only the allowed elements, attributes and style classes
- everything on the canvas
- no text over text or over a line
- every point, bar and tick number where its value puts it
- a circuit wired exactly as the brief's loop says: wires square and uncrossed, a dot on every junction, each meter's letter on it
- every food web arrow between the right two organisms, pointing from the food to what eats it
- a reaction profile's lines and curves at their levels, and each arrow's own letter nearest it
- every label in the brief present

A picture that fails is sent back once with the checker's list of problems. If the second try fails too, there is no picture. The page shows the checker's own rebuilt copy, never DeepSeek's text (\`src/components/QuestionFigure.tsx\`), styled by the \`.qf\` rules in \`src/styles.css\`.

## The request

\`POST ${FIGURE_ENDPOINT}\` with \`Authorization: Bearer $DEEPSEEK_API_KEY\` and this body:

\`\`\`json
${JSON.stringify({ ...FIGURE_REQUEST, messages: ["(system message)", "(user message)"] }, null, 2)}
\`\`\`

Price per million tokens: input $${FIGURE_PRICE.offPeak.input} ($${FIGURE_PRICE.offPeak.cachedInput} when cached), output $${FIGURE_PRICE.offPeak.output}. These are doubled at peak times (01:00–04:00 and 06:00–10:00 UTC, weekdays). Reasoning tokens count as output.

## The system message

\`\`\`text
${FIGURE_PROMPT}
\`\`\`

## The user message

This is the message for the first worked example:

\`\`\`text
${user.content}
\`\`\`

## When the checker rejects a figure

The reply goes back as the assistant's turn, followed by:

\`\`\`text
${retry.content}
\`\`\`

## Trying it

\`\`\`bash
bun scripts/figure-trial.ts
\`\`\`

That is a dry run: it shows each trial question and roughly what a run would cost, and sends nothing. \`bun scripts/figure-trial.ts run\` sends them. It needs \`DEEPSEEK_API_KEY\` in \`.env\`, and it saves each reply and the checker's verdict to \`scripts/figures/out/\`. Open \`/figures-preview\` on the dev server to see every picture on a question card.
`;
}
