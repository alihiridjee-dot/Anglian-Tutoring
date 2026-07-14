import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthService } from "@/lib/authService";
import { UserRole } from "@/types/user";

export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: async () => {
    const role = await AuthService.getUserRole();

    if (role === UserRole.TUTOR || role === UserRole.ADMIN) {
      // Tutor home is the Tutor Studio (resource management). Tutors must never
      // land on the Parent Portal — that surface is PARENT-only.
      throw redirect({ to: "/tutor" });
    } else if (role === UserRole.PARENT) {
      throw redirect({ to: "/parent-dashboard" });
    } else {
      // Students and the safe fallback both resolve to the student dashboard.
      throw redirect({ to: "/student-dashboard" });
    }
  },
  component: () => null, // Never rendered due to redirect in beforeLoad
});
