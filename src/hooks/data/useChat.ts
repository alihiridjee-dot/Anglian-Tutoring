import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isDemoMode } from "@/lib/auth/session";
import { ChatDAL, type ChatMessage, type ThreadSummary, type TutorOption } from "@/lib/chatDal";

/** Everything chat-shaped sits under this prefix, so one invalidate refreshes it. */
export const CHAT_KEY = ["chat"] as const;

/** How often an open conversation re-checks for the other side's reply. */
const POLL_MS = 20_000;

/**
 * Chat data hooks.
 *
 * Polling rather than realtime sockets: the app holds no realtime channels
 * anywhere else, and a message that lands within twenty seconds is well inside
 * what people expect of tutor correspondence. Adding a socket layer for this one
 * surface would be a new failure mode for no felt difference — and the
 * notification bell already carries anything the user misses.
 */

export function useChatThreads() {
  return useQuery({
    queryKey: [...CHAT_KEY, "threads"],
    queryFn: () => ChatDAL.listThreads(),
    enabled: !isDemoMode(),
    refetchInterval: POLL_MS,
  });
}

export function useChatMessages(threadId: string | null) {
  return useQuery({
    queryKey: [...CHAT_KEY, "messages", threadId],
    queryFn: (): Promise<ChatMessage[]> => ChatDAL.getMessages(threadId!),
    enabled: !!threadId && !isDemoMode(),
    refetchInterval: POLL_MS,
  });
}

/** Tutors a student may address, newest role grants included automatically. */
export function useTutorDirectory() {
  return useQuery({
    queryKey: [...CHAT_KEY, "tutors"],
    queryFn: (): Promise<TutorOption[]> => ChatDAL.listTutors(),
    enabled: !isDemoMode(),
    staleTime: 1000 * 60 * 30,
  });
}

/** Unread total for the sidebar badge. */
export function useChatUnread() {
  return useQuery({
    queryKey: [...CHAT_KEY, "unread"],
    queryFn: () => ChatDAL.unreadCount(),
    enabled: !isDemoMode(),
    refetchInterval: POLL_MS,
  });
}

export function useStartThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ChatDAL.startThread>[0]) => ChatDAL.startThread(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAT_KEY }),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof ChatDAL.sendMessage>[0]) => ChatDAL.sendMessage(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAT_KEY }),
  });
}

/**
 * Marks a thread read and refreshes the badges.
 *
 * Deliberately not optimistic: the badge clearing before the write lands would
 * hide a message that is still unread if the write then fails.
 */
export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => ChatDAL.markRead(threadId),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAT_KEY }),
  });
}

export type { ThreadSummary };
