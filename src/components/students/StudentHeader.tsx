import type { ReactNode } from "react";
import { useAvatarUrl } from "@/hooks/data/useAvatar";
import { resolveInitials } from "@/lib/profile/displayName";
import type { StudentRecord } from "@/lib/students/studentsDal";
import { formatDate } from "./studentPresentation";

/**
 * The record's masthead: who this is, how to reach them, and the chips that
 * summarise their course and plan (passed in by the page, which owns them).
 */
export function StudentHeader({
  name,
  email,
  record,
  children,
}: {
  name: string;
  email: string | null;
  record: StudentRecord;
  children?: ReactNode;
}) {
  const avatarUrl = useAvatarUrl(record.profile.avatar_path);
  const initials = resolveInitials(record.profile.display_name, email);

  return (
    <div className="premium-card tint-primary flex flex-wrap items-center gap-5 rounded-2xl p-5 sm:p-6">
      <div className="icon-tile size-16 shrink-0 overflow-hidden text-xl font-black">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" width={64} height={64} className="size-full object-cover" />
        ) : (
          <span aria-hidden>{initials}</span>
        )}
      </div>
      {/* From sm the chips sit beside this column. With flex-1's zero basis it had
          nothing to defend and was squeezed to a sliver instead of wrapping them.
          Below sm the chips are full width and wrap anyway. */}
      <div className="min-w-0 flex-1 sm:basis-56">
        <p className="eyebrow eyebrow-bare">Student</p>
        <h1 className="mt-1 truncate text-2xl font-extrabold sm:text-3xl">{name}</h1>
        <p className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
          {email && <span className="truncate">{email}</span>}
          <span>Joined {formatDate(record.profile.created_at)}</span>
        </p>
      </div>
      {children && (
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">{children}</div>
      )}
    </div>
  );
}
