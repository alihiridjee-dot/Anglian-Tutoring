// Grading writes authoritative source records. Derived memory is read-only;
// invalidate all views of that student rather than writing a client-made card.
export { invalidatePlanner } from "./queries";
