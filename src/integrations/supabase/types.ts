export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      homework_submissions: {
        Row: {
          feedback: string | null;
          files: Json;
          grade: string | null;
          graded_at: string | null;
          graded_by: string | null;
          id: string;
          notes: string | null;
          resource_id: string;
          score_pct: number | null;
          student_id: string;
          submitted_at: string;
        };
        Insert: {
          feedback?: string | null;
          files?: Json;
          grade?: string | null;
          graded_at?: string | null;
          graded_by?: string | null;
          id?: string;
          notes?: string | null;
          resource_id: string;
          score_pct?: number | null;
          student_id: string;
          submitted_at?: string;
        };
        Update: {
          feedback?: string | null;
          files?: Json;
          grade?: string | null;
          graded_at?: string | null;
          graded_by?: string | null;
          id?: string;
          notes?: string | null;
          resource_id?: string;
          score_pct?: number | null;
          student_id?: string;
          submitted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "homework_submissions_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "resources";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          created_at: string;
          email: string;
          handled: boolean;
          id: string;
          message: string;
          name: string;
          phone: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          handled?: boolean;
          id?: string;
          message: string;
          name: string;
          phone?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          handled?: boolean;
          id?: string;
          message?: string;
          name?: string;
          phone?: string | null;
        };
        Relationships: [];
      };
      mcq_attempts: {
        Row: {
          answers: Json;
          created_at: string;
          id: string;
          score: number;
          set_id: string;
          total: number;
          user_id: string;
        };
        Insert: {
          answers: Json;
          created_at?: string;
          id?: string;
          score: number;
          set_id: string;
          total: number;
          user_id: string;
        };
        Update: {
          answers?: Json;
          created_at?: string;
          id?: string;
          score?: number;
          set_id?: string;
          total?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mcq_attempts_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "mcq_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      mcq_questions: {
        Row: {
          correct_index: number;
          created_at: string;
          explanation: string | null;
          id: string;
          options: Json;
          position: number;
          question: string;
          set_id: string;
        };
        Insert: {
          correct_index: number;
          created_at?: string;
          explanation?: string | null;
          id?: string;
          options: Json;
          position?: number;
          question: string;
          set_id: string;
        };
        Update: {
          correct_index?: number;
          created_at?: string;
          explanation?: string | null;
          id?: string;
          options?: Json;
          position?: number;
          question?: string;
          set_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mcq_questions_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "mcq_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      mcq_sets: {
        Row: {
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          published: boolean;
          spec_point_id: string | null;
          subject: Database["public"]["Enums"]["subject"] | null;
          title: string;
          updated_at: string;
          week_number: number | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          published?: boolean;
          spec_point_id?: string | null;
          subject?: Database["public"]["Enums"]["subject"] | null;
          title: string;
          updated_at?: string;
          week_number?: number | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          published?: boolean;
          spec_point_id?: string | null;
          subject?: Database["public"]["Enums"]["subject"] | null;
          title?: string;
          updated_at?: string;
          week_number?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "mcq_sets_spec_point_id_fkey";
            columns: ["spec_point_id"];
            isOneToOne: false;
            referencedRelation: "spec_points";
            referencedColumns: ["id"];
          },
        ];
      };
      packages: {
        Row: {
          active: boolean;
          created_at: string;
          description: string | null;
          id: string;
          level: string | null;
          name: string;
          price_pence: number;
          sort_order: number;
          stripe_price_id: string | null;
          subjects: string[];
          tier: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          level?: string | null;
          name: string;
          price_pence: number;
          sort_order?: number;
          stripe_price_id?: string | null;
          subjects?: string[];
          tier: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          level?: string | null;
          name?: string;
          price_pence?: number;
          sort_order?: number;
          stripe_price_id?: string | null;
          subjects?: string[];
          tier?: string;
        };
        Relationships: [];
      };
      parent_student_links: {
        Row: {
          created_at: string;
          id: string;
          parent_id: string;
          student_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          parent_id: string;
          student_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          parent_id?: string;
          student_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          enrolled_courses: string[];
          id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["profile_role"];
          student_invite_code: string | null;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          enrolled_courses?: string[];
          id: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["profile_role"];
          student_invite_code?: string | null;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          enrolled_courses?: string[];
          id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["profile_role"];
          student_invite_code?: string | null;
        };
        Relationships: [];
      };
      resources: {
        Row: {
          board: Database["public"]["Enums"]["board"];
          created_at: string;
          created_by: string;
          description: string | null;
          due_at: string | null;
          duration_seconds: number | null;
          file_mime: string | null;
          file_name: string | null;
          file_path: string | null;
          file_size: number | null;
          id: string;
          instructions: string | null;
          join_url: string | null;
          kind: Database["public"]["Enums"]["resource_kind"];
          level: Database["public"]["Enums"]["level"];
          mark_scheme_name: string | null;
          mark_scheme_path: string | null;
          spec_point_id: string | null;
          starts_at: string | null;
          subject: Database["public"]["Enums"]["subject"];
          title: string;
          video_url: string | null;
        };
        Insert: {
          board: Database["public"]["Enums"]["board"];
          created_at?: string;
          created_by: string;
          description?: string | null;
          due_at?: string | null;
          duration_seconds?: number | null;
          file_mime?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size?: number | null;
          id?: string;
          instructions?: string | null;
          join_url?: string | null;
          kind: Database["public"]["Enums"]["resource_kind"];
          level: Database["public"]["Enums"]["level"];
          mark_scheme_name?: string | null;
          mark_scheme_path?: string | null;
          spec_point_id?: string | null;
          starts_at?: string | null;
          subject: Database["public"]["Enums"]["subject"];
          title: string;
          video_url?: string | null;
        };
        Update: {
          board?: Database["public"]["Enums"]["board"];
          created_at?: string;
          created_by?: string;
          description?: string | null;
          due_at?: string | null;
          duration_seconds?: number | null;
          file_mime?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size?: number | null;
          id?: string;
          instructions?: string | null;
          join_url?: string | null;
          kind?: Database["public"]["Enums"]["resource_kind"];
          level?: Database["public"]["Enums"]["level"];
          mark_scheme_name?: string | null;
          mark_scheme_path?: string | null;
          spec_point_id?: string | null;
          starts_at?: string | null;
          subject?: Database["public"]["Enums"]["subject"];
          title?: string;
          video_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "resources_spec_point_id_fkey";
            columns: ["spec_point_id"];
            isOneToOne: false;
            referencedRelation: "spec_points";
            referencedColumns: ["id"];
          },
        ];
      };
      session_attendees: {
        Row: {
          id: string;
          joined_at: string;
          resource_id: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          joined_at?: string;
          resource_id: string;
          user_id: string;
        };
        Update: {
          id?: string;
          joined_at?: string;
          resource_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "session_attendees_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "resources";
            referencedColumns: ["id"];
          },
        ];
      };
      spec_points: {
        Row: {
          code: string;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          sort_order: number;
          title: string;
          topic_id: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          sort_order?: number;
          title: string;
          topic_id: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          sort_order?: number;
          title?: string;
          topic_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "spec_points_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          id: string;
          plan: string | null;
          status: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          plan?: string | null;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          plan?: string | null;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      topics: {
        Row: {
          board: Database["public"]["Enums"]["board"];
          code: string | null;
          created_at: string;
          created_by: string;
          description: string | null;
          id: string;
          level: Database["public"]["Enums"]["level"];
          sort_order: number;
          subject: Database["public"]["Enums"]["subject"];
          title: string;
          updated_at: string;
        };
        Insert: {
          board: Database["public"]["Enums"]["board"];
          code?: string | null;
          created_at?: string;
          created_by: string;
          description?: string | null;
          id?: string;
          level: Database["public"]["Enums"]["level"];
          sort_order?: number;
          subject: Database["public"]["Enums"]["subject"];
          title: string;
          updated_at?: string;
        };
        Update: {
          board?: Database["public"]["Enums"]["board"];
          code?: string | null;
          created_at?: string;
          created_by?: string;
          description?: string | null;
          id?: string;
          level?: Database["public"]["Enums"]["level"];
          sort_order?: number;
          subject?: Database["public"]["Enums"]["subject"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          is_principal: boolean;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          is_principal?: boolean;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          is_principal?: boolean;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_enrolled_in: {
        Args: {
          _subject: Database["public"]["Enums"]["subject"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "student" | "tutor" | "admin";
      board: "edexcel" | "aqa" | "ocr";
      level: "gcse" | "alevel";
      profile_role: "student" | "parent" | "tutor";
      resource_kind: "video" | "download" | "live_session" | "homework";
      subject: "biology" | "chemistry" | "physics";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["student", "tutor", "admin"],
      board: ["edexcel", "aqa", "ocr"],
      level: ["gcse", "alevel"],
      profile_role: ["student", "parent", "tutor"],
      resource_kind: ["video", "download", "live_session", "homework"],
      subject: ["biology", "chemistry", "physics"],
    },
  },
} as const;
