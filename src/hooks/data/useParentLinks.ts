import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/lib/auth/session";

/**
 * The parent <-> student link lifecycle.
 *
 * Every write here is an RPC rather than a table call, because
 * `parent_link_invites` grants `authenticated` SELECT only: accepting an invite
 * is what writes `parent_student_links`, and that write is exactly what starts
 * granting a parent the child's grades and files. Routing it through
 * SECURITY DEFINER functions keeps that decision in one audited place instead
 * of spread across RLS policies.
 */

/** All link reads sit under this prefix, so one invalidate refreshes the page. */
export const PARENT_LINKS_KEY = ["parent-links"] as const;

export interface ParentLink {
  link_id: string;
  parent_id: string;
  display_name: string | null;
  email: string;
  linked_at: string;
}

export interface ChildLink {
  link_id: string;
  student_id: string;
  display_name: string | null;
  email: string;
  linked_at: string;
}

export interface PendingInvite {
  id: string;
  student_id: string;
  parent_email: string;
  status: string;
  created_at: string;
  expires_at: string;
}

/** The outcomes `invite_parent_by_email` reports without raising. */
export type InviteOutcome = "invited" | "no_account" | "not_a_parent" | "already_linked";

/** The outcomes `link_child_by_code` reports without raising. */
export type LinkChildOutcome = "linked" | "already_linked" | "not_found" | "not_a_parent";

export interface LinkChildResult {
  status: LinkChildOutcome;
  student_id?: string;
  student_name?: string;
}

async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** Parents currently linked to the signed-in student. */
export function useParentLinks(enabled = true) {
  return useQuery({
    queryKey: [...PARENT_LINKS_KEY, "parents"],
    queryFn: async (): Promise<ParentLink[]> => {
      if (isDemoMode()) return [];
      const { data, error } = await supabase.rpc("list_my_parent_links");
      if (error) throw new Error(error.message);
      return (data ?? []) as ParentLink[];
    },
    enabled: enabled && !isDemoMode(),
  });
}

/** Children currently linked to the signed-in parent. */
export function useChildLinks(enabled = true) {
  return useQuery({
    queryKey: [...PARENT_LINKS_KEY, "children"],
    queryFn: async (): Promise<ChildLink[]> => {
      if (isDemoMode()) return [];
      const { data, error } = await supabase.rpc("list_my_child_links");
      if (error) throw new Error(error.message);
      return (data ?? []) as ChildLink[];
    },
    enabled: enabled && !isDemoMode(),
  });
}

/**
 * Invites the student has sent that are still unanswered.
 *
 * Filtered on student_id rather than leaning on RLS alone: "pli invitee reads
 * addressed" also matches rows aimed at the caller's own mailbox, and those are
 * a different list with a different meaning.
 */
export function useOutgoingInvites(enabled = true) {
  return useQuery({
    queryKey: [...PARENT_LINKS_KEY, "outgoing"],
    queryFn: async (): Promise<PendingInvite[]> => {
      if (isDemoMode()) return [];
      const user = await currentUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("parent_link_invites")
        .select("id, student_id, parent_email, status, created_at, expires_at")
        .eq("student_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as PendingInvite[];
    },
    enabled: enabled && !isDemoMode(),
  });
}

/** Invites addressed to the signed-in parent's mailbox and still open. */
export function useIncomingInvites(enabled = true) {
  return useQuery({
    queryKey: [...PARENT_LINKS_KEY, "incoming"],
    queryFn: async (): Promise<PendingInvite[]> => {
      if (isDemoMode()) return [];
      const user = await currentUser();
      const email = user?.email?.toLowerCase();
      if (!email) return [];
      const { data, error } = await supabase
        .from("parent_link_invites")
        .select("id, student_id, parent_email, status, created_at, expires_at")
        .eq("parent_email", email)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      // An expired invite is still 'pending' until someone answers it — the
      // RPC refuses it, so it must not be offered as actionable here.
      const now = Date.now();
      return ((data ?? []) as PendingInvite[]).filter(
        (i) => new Date(i.expires_at).getTime() > now,
      );
    },
    enabled: enabled && !isDemoMode(),
  });
}

function useInvalidateLinks() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: PARENT_LINKS_KEY });
  };
}

export function useInviteParent() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: async (email: string): Promise<InviteOutcome> => {
      const { data, error } = await supabase.rpc("invite_parent_by_email", { _email: email });
      if (error) throw new Error(error.message);
      return (data as { status: InviteOutcome }).status;
    },
    onSuccess: invalidate,
  });
}

/**
 * Links the signed-in parent to a student by that student's invite code.
 *
 * Same trust model as the sign-up path: holding the code is the authorisation,
 * so no student acceptance step follows. Non-raising outcomes come back as a
 * status the caller can explain (bad code, not-a-parent, already linked).
 */
export function useLinkChildByCode() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: async (code: string): Promise<LinkChildResult> => {
      const { data, error } = await supabase.rpc("link_child_by_code", { _code: code });
      if (error) throw new Error(error.message);
      return data as unknown as LinkChildResult;
    },
    onSuccess: invalidate,
  });
}

export function useRespondToInvite() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: async ({ inviteId, accept }: { inviteId: string; accept: boolean }) => {
      const { error } = await supabase.rpc("respond_to_parent_invite", {
        _invite_id: inviteId,
        _accept: accept,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useRevokeInvite() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc("revoke_parent_invite", { _invite_id: inviteId });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useUnlinkParent() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase.rpc("unlink_parent", { _link_id: linkId });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

/**
 * Issues a fresh invite code, invalidating the old one.
 *
 * Existing links are deliberately untouched — see rotate_student_invite_code.
 * The enrolments cache holds the code, so it has to be refreshed too.
 */
export function useRotateInviteCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("rotate_student_invite_code");
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });
    },
  });
}
