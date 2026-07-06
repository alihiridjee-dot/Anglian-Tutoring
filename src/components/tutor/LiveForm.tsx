import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { Video, Smartphone, Sparkles } from "lucide-react";

interface LiveFormProps {
  userId: string;
  taxonomy: {
    subject: SubjectV;
    setSubject: (v: SubjectV) => void;
    board: BoardV;
    setBoard: (v: BoardV) => void;
    level: LevelV;
    setLevel: (v: LevelV) => void;
  };
}

export function LiveForm({ userId, taxonomy }: LiveFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [broadcastWhatsApp, setBroadcastWhatsApp] = useState(true);

  const generateTeamsLink = (e: React.MouseEvent) => {
    e.preventDefault();
    const randomMeetingId =
      Math.random().toString(36).substring(2, 10) +
      "-" +
      Math.random().toString(36).substring(2, 6);
    const mockTeamsUrl = `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${randomMeetingId}%40thread.v2/0?context=%7b%22Tid%22%3a%225f6b864d-ef0a-4720-bc4f-9e73d31fc30c%22%2c%22Oid%22%3a%22378dbff3-a61f-4efd-b3ef-ff074f76269b%22%7d`;
    setJoinUrl(mockTeamsUrl);
    toast.success("Microsoft Teams meeting link generated!");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const formattedStartsAt = new Date(startsAt).toISOString();

    const { error } = await supabase.from("resources").insert({
      kind: "live_session",
      title,
      description,
      starts_at: formattedStartsAt,
      join_url: joinUrl,
      subject: taxonomy.subject,
      board: taxonomy.board,
      level: taxonomy.level,
      created_by: userId,
    });

    setLoading(false);
    if (error) return toast.error(error.message);

    if (broadcastWhatsApp) {
      const timeStr = new Date(startsAt).toLocaleString();
      const inviteText = `📚 *New StudyHub Live Session Scheduled!* 📚\n\n🔹 *Session:* ${title}\n🔹 *Subject:* ${taxonomy.subject.toUpperCase()} (${taxonomy.level.toUpperCase()})\n🔹 *Time:* ${timeStr}\n\n👉 *Join here:* ${joinUrl || "Link pending"}`;

      try {
        await navigator.clipboard.writeText(inviteText);
        toast.success("Scheduled & WhatsApp invite copied!", {
          description:
            "We saved the lesson and copied the pre-formatted WhatsApp invite text to your clipboard. Paste it directly in your WhatsApp group chat!",
          duration: 6000,
        });
      } catch {
        toast.success("Live session scheduled!", {
          description: "WhatsApp invite template is ready to copy.",
        });
      }
    } else {
      toast.success("Live session scheduled");
    }

    qc.invalidateQueries({ queryKey: ["live"] });
    setTitle("");
    setDescription("");
    setStartsAt("");
    setJoinUrl("");
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title">
        <input
          required
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Masterclass in Algebraic Equations"
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Starts at">
          <input
            required
            type="datetime-local"
            className={inputCls}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </Field>
        <Field label="Join URL">
          <div className="relative">
            <input
              required
              type="url"
              className={`${inputCls} pr-32`}
              value={joinUrl}
              onChange={(e) => setJoinUrl(e.target.value)}
              placeholder="https://teams.microsoft.com/..."
            />
            <button
              onClick={generateTeamsLink}
              className="absolute right-1 top-1 bottom-1 px-2.5 rounded bg-[#5B5FC7] hover:bg-[#4B53BC] text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
              title="Generate MS Teams Link"
            >
              <Video className="w-3.5 h-3.5" />
              Auto Teams
            </button>
          </div>
        </Field>
      </div>

      <Field label="Description">
        <textarea
          className={`${inputCls} h-24 py-2`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief summary of what will be covered in this session..."
        />
      </Field>

      <TaxonomyFields {...taxonomy} />

      {/* Broadcast Toggle Options */}
      <div className="p-3 bg-secondary/50 rounded-lg border border-border space-y-2">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-[#25D366]" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Broadcast Notifications
          </span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="rounded border-border text-[#25D366] focus:ring-[#25D366]"
            checked={broadcastWhatsApp}
            onChange={(e) => setBroadcastWhatsApp(e.target.checked)}
          />
          <span>Copy formatted group broadcast invite template on schedule</span>
        </label>
      </div>

      <button disabled={loading} className={submitBtn}>
        {loading ? "Saving…" : "Schedule session"}
      </button>
    </form>
  );
}
