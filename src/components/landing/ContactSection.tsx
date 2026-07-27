import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, PhoneCall, Mail } from "lucide-react";

export function ContactSection() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.from("leads").insert({
      name,
      email,
      phone: phone || null,
      message,
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Message sent! We'll be in touch shortly.");
    setName("");
    setEmail("");
    setPhone("");
    setMessage("");
  };

  return (
    <section id="contact" className="page-aurora py-20 lg:py-24 border-t border-border">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-12 max-w-5xl mx-auto">
          <div>
            <span className="eyebrow">Get in touch</span>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Have questions? Let's talk science tutoring.
            </h2>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-md">
              We're happy to discuss your child's specific needs, assess their current levels, and
              find the best fit for our classes.
            </p>

            <div className="mt-8 space-y-4">
              <a
                href="mailto:angliaeducate@gmail.com"
                className="group flex items-center gap-3.5 text-sm text-muted-foreground hover:text-foreground transition"
              >
                <div className="surface-soft w-10 h-10 rounded-xl flex items-center justify-center transition group-hover:border-primary/30">
                  <Mail className="w-4 h-4 text-primary" />
                </div>
                angliaeducate@gmail.com
              </a>
              <a
                href="tel:07530863009"
                className="group flex items-center gap-3.5 text-sm text-muted-foreground hover:text-foreground transition"
              >
                <div className="surface-soft w-10 h-10 rounded-xl flex items-center justify-center transition group-hover:border-primary/30">
                  <PhoneCall className="w-4 h-4 text-primary" />
                </div>
                07530 863009
              </a>
            </div>
          </div>

          <div className="premium-card rounded-2xl p-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="eyebrow text-[10px]">
                  Name
                </label>
                <input
                  required
                  placeholder="Your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="premium-input w-full h-11 rounded-xl px-4 text-sm mt-1"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="eyebrow text-[10px]">
                    Email
                  </label>
                  <input
                    required
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="premium-input w-full h-11 rounded-xl px-4 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="eyebrow text-[10px]">
                    Phone (optional)
                  </label>
                  <input
                    type="tel"
                    placeholder="07123 456789"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="premium-input w-full h-11 rounded-xl px-4 text-sm mt-1"
                  />
                </div>
              </div>

              <div>
                <label className="eyebrow text-[10px]">
                  Message
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="How can we help?"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="premium-input w-full rounded-xl px-4 py-3 text-sm mt-1 resize-none"
                />
              </div>

              <button
                disabled={submitting}
                className="btn-premium w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Send className="w-3.5 h-3.5" />
                {submitting ? "Sending..." : "Send message"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
