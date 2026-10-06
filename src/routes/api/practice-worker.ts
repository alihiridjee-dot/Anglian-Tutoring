import { createFileRoute } from "@tanstack/react-router";
import { handlePracticeWorkerRequest } from "@/lib/practice/practiceQueue.server";

// The practice queue's worker: pg_cron posts here every minute while quizzes
// or tasks are waiting to be written. Server only. With no component, the route
// never reaches the browser's bundle. Every method goes to the one handler,
// which refuses anything but POST.
export const Route = createFileRoute("/api/practice-worker")({
  server: {
    handlers: {
      ANY: ({ request }) => handlePracticeWorkerRequest(request),
    },
  },
});
