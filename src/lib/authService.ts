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
      // Find linked student record to maintain single source of truth.
      //
      // Ordered and limited rather than `maybeSingle()`: a parent with two
      // children matches two rows, and `maybeSingle()` treats that as an error
      // — it returned no data, the code fell through to the parent's own id,
      // and the parent was shown an empty dashboard belonging to themselves.
      // Silently, and only for families with more than one child on the
      // platform, which is why it survived single-student testing.
      //
      // The oldest link is the stable choice: it doesn't change as siblings are
      // added. Surfaces that should let a parent switch between children need a
      // child picker, not a different default here.
      const { data: links } = await supabase
        .from("parent_student_links")
        .select("student_id, created_at")
        .eq("parent_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1);

      const first = links?.[0]?.student_id;
      if (first) return first;
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
