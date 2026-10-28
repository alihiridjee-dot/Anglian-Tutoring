import { useCallback, useEffect, useState } from "react";

/**
 * A setup step's prefill: the read that brings back what the student already
 * answered, so coming back to a step shows their answer.
 *
 * Each step used to run this from a bare effect that ignored errors, and two
 * things went wrong. A failed read left the defaults showing with nothing
 * said, and Continue then saved them over the real answers (a saved level and
 * exam year, a school blanked). A slow read landed after the student had
 * started choosing and put the old answer back over the new one. So a step
 * shows its choices, and lets Continue through, only once `ready`; shows
 * `error` with `retry` when the read failed; and `read` throws on a failed
 * query rather than coming back empty.
 *
 * `read` and `apply` run once per attempt, from the first render's closures:
 * running them again would put saved answers back over the student's choices.
 */
export function useStepPrefill<T>(read: () => Promise<T>, apply: (data: T) => void) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ ready: boolean; error: unknown }>({
    ready: false,
    error: null,
  });

  useEffect(() => {
    let live = true;
    read()
      .then((data) => {
        if (!live) return;
        apply(data);
        setState({ ready: true, error: null });
      })
      // A throw in `apply` lands here too, so the step shows Try again rather
      // than spinning for good.
      .catch((error: unknown) => {
        if (live) setState({ ready: false, error });
      });
    return () => {
      live = false;
    };
    // Once per attempt by design; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ ready: false, error: null });
    setAttempt((n) => n + 1);
  }, []);

  return { ready: state.ready, error: state.error, retry };
}
