import { supabase } from "@/integrations/supabase/client";
import { UserRole } from "@/types/user";

/**
 * Service handling unified Authentication and Role-Based Access Control (RBAC)
 */
export class AuthService {
  /**
   * Retrieves the current Supabase auth user
   */
  static async getCurrentUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    return data.user;
  }

  /**
   * Retrieves the unified user role by querying the database.
   */
  static async getUserRole(): Promise<UserRole | null> {
    const user = await this.getCurrentUser();
    if (!user) return null;

    // Check if the user is a tutor/admin via user_roles
    const { data: userRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    if (userRoles && userRoles.length > 0) {
      const roles = userRoles.map((r) => r.role);
      if (roles.includes("admin")) return UserRole.ADMIN;
      if (roles.includes("tutor")) return UserRole.TUTOR;
    }

    // Otherwise check profiles for Student/Parent role
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.role) {
      if (profile.role === "student") return UserRole.STUDENT;
      if (profile.role === "parent") return UserRole.PARENT;
      if (profile.role === "tutor") return UserRole.TUTOR;
    }

    return UserRole.STUDENT; // fallback
  }

  /**
   * Resolves the single source of truth Student ID for fetching dashboard data.
   * - If the user is a STUDENT, returns their own user ID.
   * - If the user is a PARENT, queries parent_student_links to fetch their linked child's ID.
   * This maintains data integrity by referencing the same student database record.
   */
  static async getEffectiveStudentId(): Promise<string | null> {
    const user = await this.getCurrentUser();
    if (!user) return null;

    const role = await this.getUserRole();
    if (role === UserRole.STUDENT) {
      return user.id;
    }

    if (role === UserRole.PARENT) {
      // Find linked student record to maintain single source of truth
      const { data: link } = await supabase
        .from("parent_student_links")
        .select("student_id")
        .eq("parent_id", user.id)
        .maybeSingle();

      if (link?.student_id) {
        return link.student_id;
      }
    }

    return user.id; // fallback to own ID if not linked or tutor
  }

  /**
   * Verifies if the current session has the required user role
   */
  static async verifyRoleAccess(allowedRoles: UserRole[]): Promise<boolean> {
    const userRole = await this.getUserRole();
    if (!userRole) return false;
    return allowedRoles.includes(userRole);
  }
}
