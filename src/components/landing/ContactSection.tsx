import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { useInView } from "motion/react";
import { ArrowRight, Send } from "lucide-react";
import { SectionSeam } from "@/components/landing/SectionSeam";
import { submitContactLead } from "@/lib/leads/contactLead.functions";
import { WHATSAPP_DISPLAY, WHATSAPP_NUMBER, whatsappLink } from "@/lib/leads/whatsapp";
import { cn } from "@/lib/utils";

const EMAIL = "angliaeducate@gmail.com";

/** The ways to reach us, as stops on the trail. */
type Way = "write" | "email" | "whatsapp";
const WAYS: { key: Way; name: string; emoji: string; tint: string }[] = [
  { key: "write", name: "Write to us", emoji: "✍️", tint: "tint-primary" },
  { key: "email", name: "Email", emoji: "✉️", tint: "tint-amber" },
  { key: "whatsapp", name: "WhatsApp", emoji: "💬", tint: "tint-emerald" },
];

/**
 * Whether the section has been reached. A section that starts below the fold
 * waits to be scrolled to before its underline draws; one already on screen,
 * or a reader who asked for less motion, gets it at once.
 */
function useArrived(ref: React.RefObject<HTMLElement | null>) {
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top > window.innerHeight) setArmed(true);
  }, [ref]);
  return !armed || inView;
}

/**
 * The contact section, in the house style ("playful minimalism", README): the
 * title on the page with a highlighter stroke under the words that carry it,
 * one dark line, then the ways to reach us as stops on a dotted line. The
 * picked stop opens in one card underneath: the form, our email address, or
 * WhatsApp. The form's Send button carries a paper plane that takes off.
 */
export function ContactSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const arrived = useArrived(sectionRef);
  const [way, setWay] = useState<Way>("write");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  // Honeypot: never shown to a person, so a real submission leaves it empty.
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await submitContactLead({ data: { name, email, phone: phone || null, message, website } });
      toast.success("Message sent! We'll be in touch shortly.");
      setName("");
      setEmail("");
      setPhone("");
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "We couldn't send that just now.");
    } finally {
      setSubmitting(false);
    }
  };

  const picked = WAYS.find((w) => w.key === way) ?? WAYS[0];

  return (
    <section
      ref={sectionRef}
      id="contact"
      data-in={arrived}
      className="contact page-aurora pb-20 lg:pb-24"
    >
      <SectionSeam from="var(--secondary)" className="mb-12 lg:mb-16" />
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <h2 className="text-foreground text-center text-4xl leading-[1.1] font-extrabold sm:text-5xl">
          Have questions? Let&apos;s talk{" "}
          <span className="contact-mark">
            science tutoring
            <svg
              aria-hidden
              className="contact-squiggle"
              viewBox="0 0 120 12"
              preserveAspectRatio="none"
            >
              <path d="M2 7 Q 12 1 22 7 T 42 7 T 62 7 T 82 7 T 102 7 T 118 6" />
            </svg>
          </span>
        </h2>
        <p className="text-foreground mx-auto mt-7 max-w-md text-center text-lg leading-relaxed font-medium">
          We&apos;re happy to discuss your child&apos;s specific needs, assess their current levels,
          and find the best fit for our classes.
        </p>

        <div
          role="tablist"
          aria-label="How to reach us"
          className="point-trail contact-trail mt-12"
          style={{ "--stops": WAYS.length } as CSSProperties}
        >
          <svg
            aria-hidden
            className="point-trail-path"
            viewBox="0 0 200 40"
            preserveAspectRatio="none"
          >
            <path
              d="M0 20 C30 4 70 36 100 20 C130 36 170 4 200 20"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {WAYS.map((w) => (
            <button
              key={w.key}
              type="button"
              role="tab"
              id={`contact-stop-${w.key}`}
              aria-selected={w.key === way}
              aria-controls="contact-panel"
              onClick={() => setWay(w.key)}
              className={`point-stop ${w.tint}`}
            >
              <span className="point-stop-dot">
                <span aria-hidden>{w.emoji}</span>
              </span>
              <span className="point-stop-label">{w.name}</span>
            </button>
          ))}
        </div>

        <div
          key={way}
          id="contact-panel"
          role="tabpanel"
          aria-labelledby={`contact-stop-${way}`}
          className={`point-panel premium-card ${picked.tint} rounded-3xl p-5 sm:p-8`}
        >
          {way === "write" && (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Honeypot — hidden from people, catnip for bots. Not tab-reachable. */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="hidden"
              />
              <div>
                <label htmlFor="contact-name" className="ask-label">
                  Name
                </label>
                <input
                  id="contact-name"
                  type="text"
                  autoComplete="name"
                  required
                  placeholder="Your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pop-input mt-2 h-12 w-full px-4 text-base"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
                <div>
                  <label htmlFor="contact-email" className="ask-label">
                    Email
                  </label>
                  <input
                    id="contact-email"
                    required
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pop-input mt-2 h-12 w-full px-4 text-base"
                  />
                </div>
                <div>
                  <label htmlFor="contact-phone" className="ask-label">
                    Phone <span className="font-sans text-base font-semibold">(optional)</span>
                  </label>
                  <input
                    id="contact-phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="07123 456789"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="pop-input mt-2 h-12 w-full px-4 text-base"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="contact-message" className="ask-label">
                  Message
                </label>
                <textarea
                  id="contact-message"
                  required
                  rows={4}
                  placeholder="How can we help?"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="pop-input mt-2 w-full resize-none p-4 text-base"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-solid paywall-btn contact-send w-full"
              >
                {submitting ? "Sending…" : "Send message"}
                <Send
                  className={cn("contact-plane size-5", submitting && "contact-plane-off")}
                  aria-hidden
                />
              </button>
            </form>
          )}

          {way === "email" && (
            <div className="flex flex-col items-center gap-6 py-3 text-center">
              <p className="text-foreground font-display text-2xl font-extrabold break-all sm:text-3xl">
                {EMAIL}
              </p>
              <a href={`mailto:${EMAIL}`} className="btn-solid paywall-btn">
                Write an email
                <ArrowRight className="paywall-arrow size-5" aria-hidden />
              </a>
            </div>
          )}

          {way === "whatsapp" && (
            <div className="flex flex-col items-center gap-6 py-3 text-center">
              {/* The same number takes calls, so on a phone it still rings. */}
              <a
                href={`tel:+${WHATSAPP_NUMBER}`}
                className="text-foreground font-display text-2xl font-extrabold sm:text-3xl"
              >
                {WHATSAPP_DISPLAY}
              </a>
              <a
                href={whatsappLink()}
                target="_blank"
                rel="noreferrer"
                className="btn-solid paywall-btn"
              >
                Chat on WhatsApp
                <ArrowRight className="paywall-arrow size-5" aria-hidden />
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
