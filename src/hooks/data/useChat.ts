import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isDemoMode } from "@/lib/auth/session";
import { useRoles } from "@/hooks/useRole";
import {
  ChatDAL,
  type ChatMessage,
  type ThreadSummary,
  type TutorOption,
} from "@/lib/chat/chatDal";

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

/**
 * Chat needs a signed-in caller, not merely a non-demo one.
 *
 * `chat_unread_count` and friends are revoked from `anon` on purpose — a
 * visitor with no session has no unread messages to count. But these queries
 * only checked for demo mode, so on every page they fired before the session
 * had hydrated, hit PostgREST as `anon` and came back 42501 *permission
 * denied*. The badge swallowed it and rendered 0, so the only symptom was a
 * console full of 403s repeating on the poll interval.
 *
 * Waiting for the user id is the whole fix: the grant was right, the caller
 * was wrong.
 */
function useChatEnabled(): boolean {
  const { userId, loading } = useRoles();
  return !isDemoMode() && !loading && !!userId;
}

export function useChatThreads() {
  const enabled = useChatEnabled();
  return useQuery({
    queryKey: [...CHAT_KEY, "threads"],
    queryFn: () => ChatDAL.listThreads(),
    enabled,
    refetchInterval: POLL_MS,
  });
}

export function useChatMessages(threadId: string | null) {
  const enabled = useChatEnabled();
  return useQuery({
    queryKey: [...CHAT_KEY, "messages", threadId],
    queryFn: (): Promise<ChatMessage[]> => ChatDAL.getMessages(threadId!),
    enabled: !!threadId && enabled,
    refetchInterval: POLL_MS,
  });
}

/** Tutors a student may address, newest role grants included automatically. */
export function useTutorDirectory() {
  const enabled = useChatEnabled();
  return useQuery({
    queryKey: [...CHAT_KEY, "tutors"],
    queryFn: (): Promise<TutorOption[]> => ChatDAL.listTutors(),
    enabled,
    staleTime: 1000 * 60 * 30,
  });
}

/** Unread total for the sidebar badge. */
export function useChatUnread() {
  const enabled = useChatEnabled();
  return useQuery({
    queryKey: [...CHAT_KEY, "unread"],
    queryFn: () => ChatDAL.unreadCount(),
    enabled,
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

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => ChatDAL.deleteThread(threadId),
    // The bell holds copies of the message text, so it refreshes too.
    onSuccess: () => qc.invalidateQueries(),
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
