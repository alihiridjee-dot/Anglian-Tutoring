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
          acknowledged_at: string | null;
          feedback: string | null;
          files: Json;
          files_deleted_at: string | null;
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
          acknowledged_at?: string | null;
          feedback?: string | null;
          files?: Json;
          files_deleted_at?: string | null;
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
          acknowledged_at?: string | null;
          feedback?: string | null;
          files?: Json;
          files_deleted_at?: string | null;
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
          spec_point_id: string | null;
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
          spec_point_id?: string | null;
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
          spec_point_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mcq_questions_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "mcq_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mcq_questions_spec_point_id_fkey";
            columns: ["spec_point_id"];
            isOneToOne: false;
            referencedRelation: "spec_points";
            referencedColumns: ["id"];
          },
        ];
      };
      mcq_sets: {
        Row: {
          created_at: string;
          created_by: string;
          description: string | null;
          due_at: string | null;
          id: string;
          published: boolean;
          resource_id: string | null;
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
          due_at?: string | null;
          id?: string;
          published?: boolean;
          resource_id?: string | null;
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
          due_at?: string | null;
          id?: string;
          published?: boolean;
          resource_id?: string | null;
          spec_point_id?: string | null;
          subject?: Database["public"]["Enums"]["subject"] | null;
          title?: string;
          updated_at?: string;
          week_number?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "mcq_sets_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "resources";
            referencedColumns: ["id"];
          },
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
          billing_interval: string | null;
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
          billing_interval?: string | null;
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
          billing_interval?: string | null;
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
      parent_link_invites: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          parent_email: string;
          responded_at: string | null;
          responded_by: string | null;
          status: string;
          student_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          parent_email: string;
          responded_at?: string | null;
          responded_by?: string | null;
          status?: string;
          student_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          parent_email?: string;
          responded_at?: string | null;
          responded_by?: string | null;
          status?: string;
          student_id?: string;
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
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          link: string | null;
          read_at: string | null;
          submission_id: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          link?: string | null;
          read_at?: string | null;
          submission_id?: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          link?: string | null;
          read_at?: string | null;
          submission_id?: string | null;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "homework_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      resource_spec_points: {
        Row: {
          created_at: string;
          resource_id: string;
          spec_point_id: string;
        };
        Insert: {
          created_at?: string;
          resource_id: string;
          spec_point_id: string;
        };
        Update: {
          created_at?: string;
          resource_id?: string;
          spec_point_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resource_spec_points_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "resources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_spec_points_spec_point_id_fkey";
            columns: ["spec_point_id"];
            isOneToOne: false;
            referencedRelation: "spec_points";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          enrolled_courses: string[];
          id: string;
          level: Database["public"]["Enums"]["level"] | null;
          onboarding_completed_at: string | null;
          phone: string | null;
          role: Database["public"]["Enums"]["profile_role"];
          school: string | null;
          student_invite_code: string | null;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          enrolled_courses?: string[];
          id: string;
          level?: Database["public"]["Enums"]["level"] | null;
          onboarding_completed_at?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["profile_role"];
          school?: string | null;
          student_invite_code?: string | null;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          enrolled_courses?: string[];
          id?: string;
          level?: Database["public"]["Enums"]["level"] | null;
          onboarding_completed_at?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["profile_role"];
          school?: string | null;
          student_invite_code?: string | null;
        };
        Relationships: [];
      };
      resources: {
        Row: {
          board: Database["public"]["Enums"]["board"] | null;
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
          board?: Database["public"]["Enums"]["board"] | null;
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
          board?: Database["public"]["Enums"]["board"] | null;
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
      stripe_customers: {
        Row: {
          created_at: string;
          stripe_customer_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          stripe_customer_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          stripe_customer_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stripe_customers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      student_enrolments: {
        Row: {
          board: Database["public"]["Enums"]["board"];
          created_at: string;
          current_grade: string | null;
          id: string;
          previous_grade: string | null;
          student_id: string;
          subject: Database["public"]["Enums"]["subject"];
          target_grade: string | null;
        };
        Insert: {
          board: Database["public"]["Enums"]["board"];
          created_at?: string;
          current_grade?: string | null;
          id?: string;
          previous_grade?: string | null;
          student_id: string;
          subject: Database["public"]["Enums"]["subject"];
          target_grade?: string | null;
        };
        Update: {
          board?: Database["public"]["Enums"]["board"];
          created_at?: string;
          current_grade?: string | null;
          id?: string;
          previous_grade?: string | null;
          student_id?: string;
          subject?: Database["public"]["Enums"]["subject"];
          target_grade?: string | null;
        };
        Relationships: [];
      };
      student_learning_profile: {
        Row: {
          responses: Json;
          student_id: string;
          updated_at: string;
        };
        Insert: {
          responses?: Json;
          student_id: string;
          updated_at?: string;
        };
        Update: {
          responses?: Json;
          student_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_learning_profile_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      student_program_plan: {
        Row: {
          acknowledged_at: string;
          exam_date: string;
          pacing: Json;
          program_start: string;
          student_id: string;
          subject: Database["public"]["Enums"]["subject"];
          updated_at: string;
        };
        Insert: {
          acknowledged_at?: string;
          exam_date: string;
          pacing: Json;
          program_start: string;
          student_id: string;
          subject: Database["public"]["Enums"]["subject"];
          updated_at?: string;
        };
        Update: {
          acknowledged_at?: string;
          exam_date?: string;
          pacing?: Json;
          program_start?: string;
          student_id?: string;
          subject?: Database["public"]["Enums"]["subject"];
          updated_at?: string;
        };
        Relationships: [];
      };
      student_spec_point_confidence: {
        Row: {
          confidence: number;
          spec_point_id: string;
          student_id: string;
          updated_at: string;
        };
        Insert: {
          confidence?: number;
          spec_point_id: string;
          student_id: string;
          updated_at?: string;
        };
        Update: {
          confidence?: number;
          spec_point_id?: string;
          student_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_spec_point_confidence_spec_point_id_fkey";
            columns: ["spec_point_id"];
            isOneToOne: false;
            referencedRelation: "spec_points";
            referencedColumns: ["id"];
          },
        ];
      };
      student_spec_point_reviews: {
        Row: {
          id: string;
          rating: number;
          reviewed_at: string;
          score_pct: number | null;
          source: string;
          source_id: string | null;
          spec_point_id: string;
          student_id: string;
        };
        Insert: {
          id?: string;
          rating: number;
          reviewed_at?: string;
          score_pct?: number | null;
          source: string;
          source_id?: string | null;
          spec_point_id: string;
          student_id: string;
        };
        Update: {
          id?: string;
          rating?: number;
          reviewed_at?: string;
          score_pct?: number | null;
          source?: string;
          source_id?: string | null;
          spec_point_id?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_spec_point_reviews_spec_point_id_fkey";
            columns: ["spec_point_id"];
            isOneToOne: false;
            referencedRelation: "spec_points";
            referencedColumns: ["id"];
          },
        ];
      };
      student_spec_point_schedule: {
        Row: {
          card: Json;
          due: string;
          last_review: string | null;
          spec_point_id: string;
          student_id: string;
          updated_at: string;
        };
        Insert: {
          card: Json;
          due: string;
          last_review?: string | null;
          spec_point_id: string;
          student_id: string;
          updated_at?: string;
        };
        Update: {
          card?: Json;
          due?: string;
          last_review?: string | null;
          spec_point_id?: string;
          student_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_spec_point_schedule_spec_point_id_fkey";
            columns: ["spec_point_id"];
            isOneToOne: false;
            referencedRelation: "spec_points";
            referencedColumns: ["id"];
          },
        ];
      };
      student_term_plans: {
        Row: {
          board: Database["public"]["Enums"]["board"];
          created_at: string;
          ends_on: string;
          id: string;
          label: string | null;
          level: Database["public"]["Enums"]["level"];
          starts_on: string;
          student_id: string;
          subject: Database["public"]["Enums"]["subject"];
          updated_at: string;
        };
        Insert: {
          board: Database["public"]["Enums"]["board"];
          created_at?: string;
          ends_on: string;
          id?: string;
          label?: string | null;
          level: Database["public"]["Enums"]["level"];
          starts_on: string;
          student_id: string;
          subject: Database["public"]["Enums"]["subject"];
          updated_at?: string;
        };
        Update: {
          board?: Database["public"]["Enums"]["board"];
          created_at?: string;
          ends_on?: string;
          id?: string;
          label?: string | null;
          level?: Database["public"]["Enums"]["level"];
          starts_on?: string;
          student_id?: string;
          subject?: Database["public"]["Enums"]["subject"];
          updated_at?: string;
        };
        Relationships: [];
      };
      student_topic_confidence: {
        Row: {
          confidence: number;
          sort_index: number;
          student_id: string;
          topic_id: string;
          updated_at: string;
        };
        Insert: {
          confidence?: number;
          sort_index?: number;
          student_id: string;
          topic_id: string;
          updated_at?: string;
        };
        Update: {
          confidence?: number;
          sort_index?: number;
          student_id?: string;
          topic_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_topic_confidence_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      student_weekly_checkins: {
        Row: {
          coverage: Json;
          covered_ok: boolean | null;
          created_at: string;
          id: string;
          plan_id: string;
          reflection: string | null;
          student_id: string;
        };
        Insert: {
          coverage?: Json;
          covered_ok?: boolean | null;
          created_at?: string;
          id?: string;
          plan_id: string;
          reflection?: string | null;
          student_id: string;
        };
        Update: {
          coverage?: Json;
          covered_ok?: boolean | null;
          created_at?: string;
          id?: string;
          plan_id?: string;
          reflection?: string | null;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_weekly_checkins_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: true;
            referencedRelation: "student_weekly_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      student_weekly_plan_points: {
        Row: {
          created_at: string;
          origin: Database["public"]["Enums"]["plan_point_origin"];
          plan_id: string;
          spec_point_id: string;
        };
        Insert: {
          created_at?: string;
          origin?: Database["public"]["Enums"]["plan_point_origin"];
          plan_id: string;
          spec_point_id: string;
        };
        Update: {
          created_at?: string;
          origin?: Database["public"]["Enums"]["plan_point_origin"];
          plan_id?: string;
          spec_point_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_weekly_plan_points_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "student_weekly_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_weekly_plan_points_spec_point_id_fkey";
            columns: ["spec_point_id"];
            isOneToOne: false;
            referencedRelation: "spec_points";
            referencedColumns: ["id"];
          },
        ];
      };
      student_weekly_plans: {
        Row: {
          ai_rationale: string | null;
          board: Database["public"]["Enums"]["board"];
          created_at: string;
          id: string;
          level: Database["public"]["Enums"]["level"];
          note: string | null;
          source: Database["public"]["Enums"]["plan_source"];
          student_id: string;
          subject: Database["public"]["Enums"]["subject"];
          term_plan_id: string | null;
          updated_at: string;
          week_start: string;
        };
        Insert: {
          ai_rationale?: string | null;
          board: Database["public"]["Enums"]["board"];
          created_at?: string;
          id?: string;
          level: Database["public"]["Enums"]["level"];
          note?: string | null;
          source?: Database["public"]["Enums"]["plan_source"];
          student_id: string;
          subject: Database["public"]["Enums"]["subject"];
          term_plan_id?: string | null;
          updated_at?: string;
          week_start: string;
        };
        Update: {
          ai_rationale?: string | null;
          board?: Database["public"]["Enums"]["board"];
          created_at?: string;
          id?: string;
          level?: Database["public"]["Enums"]["level"];
          note?: string | null;
          source?: Database["public"]["Enums"]["plan_source"];
          student_id?: string;
          subject?: Database["public"]["Enums"]["subject"];
          term_plan_id?: string | null;
          updated_at?: string;
          week_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_weekly_plans_term_plan_id_fkey";
            columns: ["term_plan_id"];
            isOneToOne: false;
            referencedRelation: "student_term_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      student_weekly_tutor_notes: {
        Row: {
          author_id: string;
          next_points: string[];
          note: string | null;
          plan_id: string;
          student_id: string;
          updated_at: string;
        };
        Insert: {
          author_id: string;
          next_points?: string[];
          note?: string | null;
          plan_id: string;
          student_id: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          next_points?: string[];
          note?: string | null;
          plan_id?: string;
          student_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_weekly_tutor_notes_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: true;
            referencedRelation: "student_weekly_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_end: string | null;
          id: string;
          plan: string | null;
          status: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          student_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          plan?: string | null;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          student_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          plan?: string | null;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          student_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
      weekly_focus: {
        Row: {
          ai_summary: string | null;
          board: Database["public"]["Enums"]["board"];
          created_at: string;
          created_by: string;
          id: string;
          level: Database["public"]["Enums"]["level"];
          note: string | null;
          subject: Database["public"]["Enums"]["subject"];
          updated_at: string;
          week_start: string;
        };
        Insert: {
          ai_summary?: string | null;
          board: Database["public"]["Enums"]["board"];
          created_at?: string;
          created_by: string;
          id?: string;
          level: Database["public"]["Enums"]["level"];
          note?: string | null;
          subject: Database["public"]["Enums"]["subject"];
          updated_at?: string;
          week_start: string;
        };
        Update: {
          ai_summary?: string | null;
          board?: Database["public"]["Enums"]["board"];
          created_at?: string;
          created_by?: string;
          id?: string;
          level?: Database["public"]["Enums"]["level"];
          note?: string | null;
          subject?: Database["public"]["Enums"]["subject"];
          updated_at?: string;
          week_start?: string;
        };
        Relationships: [];
      };
      weekly_focus_points: {
        Row: {
          created_at: string;
          focus_id: string;
          spec_point_id: string;
        };
        Insert: {
          created_at?: string;
          focus_id: string;
          spec_point_id: string;
        };
        Update: {
          created_at?: string;
          focus_id?: string;
          spec_point_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "weekly_focus_points_focus_id_fkey";
            columns: ["focus_id"];
            isOneToOne: false;
            referencedRelation: "weekly_focus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "weekly_focus_points_spec_point_id_fkey";
            columns: ["spec_point_id"];
            isOneToOne: false;
            referencedRelation: "spec_points";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      acknowledge_submission: {
        Args: { _submission_id: string };
        Returns: undefined;
      };
      my_access_state: {
        Args: never;
        Returns: {
          has_access: boolean;
          onboarding_complete: boolean;
        }[];
      };
      mark_submission_files_deleted: {
        Args: { _submission_id: string };
        Returns: undefined;
      };
      is_enrolled_in: {
        Args: {
          _subject: Database["public"]["Enums"]["subject"];
          _user_id: string;
        };
        Returns: boolean;
      };
      rotate_student_invite_code: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      invite_parent_by_email: {
        Args: { _email: string };
        Returns: Json;
      };
      respond_to_parent_invite: {
        Args: { _invite_id: string; _accept: boolean };
        Returns: Json;
      };
      revoke_parent_invite: {
        Args: { _invite_id: string };
        Returns: undefined;
      };
      unlink_parent: {
        Args: { _link_id: string };
        Returns: undefined;
      };
      list_my_parent_links: {
        Args: Record<PropertyKey, never>;
        Returns: {
          link_id: string;
          parent_id: string;
          display_name: string | null;
          email: string;
          linked_at: string;
        }[];
      };
      list_my_child_links: {
        Args: Record<PropertyKey, never>;
        Returns: {
          link_id: string;
          student_id: string;
          display_name: string | null;
          email: string;
          linked_at: string;
        }[];
      };
    };
    Enums: {
      app_role: "student" | "tutor" | "admin";
      board: "edexcel" | "aqa" | "ocr";
      level: "gcse" | "alevel";
      plan_point_origin: "ai" | "student" | "tutor" | "carried_over";
      plan_source: "ai" | "student" | "tutor";
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
      plan_point_origin: ["ai", "student", "tutor", "carried_over"],
      plan_source: ["ai", "student", "tutor"],
      profile_role: ["student", "parent", "tutor"],
      resource_kind: ["video", "download", "live_session", "homework"],
      subject: ["biology", "chemistry", "physics"],
    },
  },
} as const;
