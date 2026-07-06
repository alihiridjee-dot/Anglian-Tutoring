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
    <section id="contact" className="py-20 lg:py-24 bg-slate-50 border-t border-slate-100">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-12 max-w-5xl mx-auto">
          <div>
            <span className="text-xs uppercase tracking-widest text-slate-500 font-bold">
              GET IN TOUCH
            </span>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
              Have questions? Let's talk science tutoring.
            </h2>
            <p className="mt-4 text-base text-slate-500 leading-relaxed max-w-md">
              We're happy to discuss your child's specific needs, assess their current levels, and
              find the best fit for our classes.
            </p>

            <div className="mt-8 space-y-4">
              <a
                href="mailto:info@angliantutoring.co.uk"
                className="flex items-center gap-3.5 text-sm text-slate-600 hover:text-slate-900 transition"
              >
                <div className="w-10 h-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center">
                  <Mail className="w-4 h-4 text-slate-700" />
                </div>
                info@angliantutoring.co.uk
              </a>
              <a
                href="tel:07530863009"
                className="flex items-center gap-3.5 text-sm text-slate-600 hover:text-slate-900 transition"
              >
                <div className="w-10 h-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center">
                  <PhoneCall className="w-4 h-4 text-slate-700" />
                </div>
                07530 863009
              </a>
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-8 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                  Name
                </label>
                <input
                  required
                  placeholder="Your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-11 rounded-xl bg-slate-50/50 border border-slate-200 px-4 text-sm mt-1 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                    Email
                  </label>
                  <input
                    required
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-11 rounded-xl bg-slate-50/50 border border-slate-200 px-4 text-sm mt-1 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                    Phone (optional)
                  </label>
                  <input
                    type="tel"
                    placeholder="07123 456789"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full h-11 rounded-xl bg-slate-50/50 border border-slate-200 px-4 text-sm mt-1 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                  Message
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="How can we help?"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full rounded-xl bg-slate-50/50 border border-slate-200 px-4 py-3 text-sm mt-1 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition"
                />
              </div>

              <button
                disabled={submitting}
                className="w-full h-11 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition flex items-center justify-center gap-2"
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
