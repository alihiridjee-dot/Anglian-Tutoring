// An in-memory stand-in for the slice of the Anthropic SDK mark-homework uses,
// mapped over "npm:@anthropic-ai/sdk@0.111.0" by the import map in this folder,
// so the real function code runs against it. No network.
//
// A test sets ANTHROPIC.reply to decide what the "model" answers, and reads
// ANTHROPIC.calls to see exactly what it was sent.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const ANTHROPIC = {
  calls: [] as any[],
  reply: (_request: any): any => ({ questions: [], summary: "" }),
};

export function resetAnthropic() {
  ANTHROPIC.calls = [];
  ANTHROPIC.reply = () => ({ questions: [], summary: "" });
}

export default class Anthropic {
  constructor(_opts?: unknown) {}
  messages = {
    create: async (request: any) => {
      ANTHROPIC.calls.push(request);
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(ANTHROPIC.reply(request)) }],
      };
    },
  };
}
