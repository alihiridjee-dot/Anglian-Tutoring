// An in-memory stand-in for the slice of the Anthropic SDK mark-homework uses,
// mapped over "npm:@anthropic-ai/sdk@0.111.0" by the import map in this folder,
// so the real function code runs against it. No network.
//
// A test sets ANTHROPIC.reply to decide what the "model" answers, and reads
// ANTHROPIC.calls to see exactly what it was sent, and ANTHROPIC.options to
// see how the client was made. A test that sets ANTHROPIC.real gets the real
// SDK's client instead, made from the same options, so its own timeout and
// retries run.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const ANTHROPIC = {
  calls: [] as any[],
  options: undefined as any,
  real: undefined as undefined | ((opts: any) => any),
  reply: (_request: any): any => ({ questions: [], summary: "" }),
};

export function resetAnthropic() {
  ANTHROPIC.calls = [];
  ANTHROPIC.options = undefined;
  ANTHROPIC.real = undefined;
  ANTHROPIC.reply = () => ({ questions: [], summary: "" });
}

export default class Anthropic {
  constructor(opts?: unknown) {
    ANTHROPIC.options = opts;
    if (ANTHROPIC.real) this.messages = ANTHROPIC.real(opts).messages;
  }
  messages: any = {
    create: async (request: any) => {
      ANTHROPIC.calls.push(request);
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(ANTHROPIC.reply(request)) }],
      };
    },
  };
}
