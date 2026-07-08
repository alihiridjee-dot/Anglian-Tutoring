import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthService } from "@/lib/authService";
import { UserRole } from "@/types/user";

export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: async () => {
    const role = await AuthService.getUserRole();

    if (role === UserRole.STUDENT) {
      throw redirect({ to: "/student-dashboard" });
    } else if (role === UserRole.PARENT) {
      throw redirect({ to: "/parent-dashboard" });
    } else if (role === UserRole.TUTOR || role === UserRole.ADMIN) {
      // Tutors or admins default to parent view dashboard or tutor portal
      throw redirect({ to: "/parent-dashboard" });
    } else {
      // Fallback
      throw redirect({ to: "/student-dashboard" });
    }
  },
  component: () => null, // Never rendered due to redirect in beforeLoad
});
