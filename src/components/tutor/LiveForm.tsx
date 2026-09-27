import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { SpecPointSelect } from "./SpecPointSelect";
import { Video, Loader2, Sparkles } from "lucide-react";
import { useLiveForm, type LiveFormProps } from "./useLiveForm";
import { AiSuggestRow, BroadcastToggle, WeekLinkBanner } from "./LiveFormParts";

export function LiveForm({ userId, taxonomy, linkToWeek = false }: LiveFormProps) {
  const {
    title,
    setTitle,
    description,
    setDescription,
    startsAt,
    setStartsAt,
    joinUrl,
    setJoinUrl,
    specPointIds,
    setSpecPointIds,
    loading,
    generatingLink,
    generatingBlurb,
    suggesting,
    broadcastWhatsApp,
    setBroadcastWhatsApp,
    validStart,
    weekLabel,
    weekLoading,
    weekFocus,
    generateZoomLink,
    generateDescription,
    suggestFromDescription,
    submit,
  } = useLiveForm({ userId, taxonomy, linkToWeek });

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
          <div className="sm:relative">
            <input
              type="url"
              inputMode="url"
              className={`${inputCls} sm:pr-32`}
              value={joinUrl}
              onChange={(e) => setJoinUrl(e.target.value)}
              placeholder="Auto Zoom, paste a link, or leave for later"
            />
            <button
              onClick={generateZoomLink}
              disabled={generatingLink}
              className="mt-2 h-11 w-full justify-center sm:mt-0 sm:h-auto sm:w-auto sm:absolute sm:right-1 sm:top-1 sm:bottom-1 px-2.5 rounded bg-[#2D8CFF] hover:bg-[#2681F2] text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-70"
              title="Create a Zoom meeting"
            >
              {generatingLink ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Video className="w-3.5 h-3.5" />
              )}
              {generatingLink ? "Creating…" : "Auto Zoom"}
            </button>
          </div>
        </Field>
      </div>

      <Field label="Description">
        <div className="flex flex-col-reverse gap-2 sm:block sm:relative">
          <textarea
            className={`${inputCls} h-24 py-2`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief summary of what will be covered in this session..."
          />
          <button
            onClick={generateDescription}
            disabled={generatingBlurb}
            className="self-end min-h-11 sm:min-h-0 sm:absolute sm:right-1.5 sm:top-1.5 px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/15 text-primary text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-70"
            title="Draft a description with AI from the title & spec points"
          >
            {generatingBlurb ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {generatingBlurb ? "Drafting…" : "AI draft"}
          </button>
        </div>
      </Field>

      <TaxonomyFields {...taxonomy} hideBoard />

      {/* Week link banner — only in dashboard mode, once a date is picked. */}
      {linkToWeek && validStart && (
        <WeekLinkBanner weekLoading={weekLoading} weekFocus={weekFocus} weekLabel={weekLabel} />
      )}

      <AiSuggestRow suggesting={suggesting} suggestFromDescription={suggestFromDescription} />

      <SpecPointSelect
        subject={taxonomy.subject}
        level={taxonomy.level}
        value={specPointIds}
        onChange={setSpecPointIds}
        required
      />

      {/* Broadcast Toggle Options */}
      <BroadcastToggle
        broadcastWhatsApp={broadcastWhatsApp}
        setBroadcastWhatsApp={setBroadcastWhatsApp}
      />

      <button disabled={loading} className={submitBtn}>
        {loading ? "Saving…" : "Schedule session"}
      </button>
    </form>
  );
}
