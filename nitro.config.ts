// Nitro reads this file alongside vite.config.ts, whose `nitro` option only
// takes a preset and output paths. Only the Vercel build uses it.
import { defineConfig } from "nitro/config";

export default defineConfig({
  vercel: {
    functionRules: {
      // The practice queue's worker writes up to three quizzes or tasks side by
      // side, each one model call of up to 200 s. Built as its own function with
      // Vercel's 300 s limit, so the rest of the site keeps its own.
      "/api/practice-worker": { maxDuration: 300 },
    },
  },
});
