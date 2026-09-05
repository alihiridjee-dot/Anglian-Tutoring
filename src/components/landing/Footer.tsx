import { Link } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";

import { Mascot } from "@/components/Doodles";

export function Footer() {
  return (
    <footer
      className="text-primary-foreground/70 relative overflow-hidden py-12"
      style={{
        background:
          "linear-gradient(135deg, var(--primary-deep), color-mix(in oklab, var(--accent) 30%, var(--primary-deep)))",
      }}
    >
      {/* The same dot grid as the page backdrop, inverted. It stops the footer
          reading as a flat block of colour pasted under the page. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage: "radial-gradient(white 1.1px, transparent 1.1px)",
          backgroundSize: "1.375rem 1.375rem",
          maskImage: "radial-gradient(60rem 20rem at 50% 120%, black, transparent 75%)",
        }}
      />

      <div className="relative mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 md:flex-row">
        <div className="text-primary-foreground flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl border-2 border-white/25 bg-white/15 shadow-[0_3px_0_0_rgba(0,0,0,0.18)]">
            <GraduationCap className="size-5" aria-hidden />
          </div>
          <span className="font-display text-[0.95rem] leading-tight font-extrabold">
            Anglia
            <span className="text-primary-foreground/60 block text-[0.7rem] font-bold tracking-[0.18em] uppercase">
              Educate
            </span>
          </span>
        </div>

        {/* The nav bar's section links are desktop-only, so the footer carries
            the standalone pages for mobile visitors. */}
        <nav className="flex items-center gap-6 text-sm font-semibold">
          <Link to="/how-it-works" className="hover:text-primary-foreground transition">
            How it works
          </Link>
          <Link to="/" hash="pricing" className="hover:text-primary-foreground transition">
            Pricing
          </Link>
          <Link to="/" hash="contact" className="hover:text-primary-foreground transition">
            Contact
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          {/* The one character on the marketing pages that isn't making a
              point — it just waves you off the bottom of the site. */}
          <Mascot
            name="owl"
            mood="wink"
            size={56}
            className="hidden shrink-0 text-[color:var(--primary-deep)] sm:block"
          />
          <p className="text-primary-foreground/60 max-w-56 text-xs">
            © {new Date().getFullYear()} Anglia Educate. All rights reserved. Registered UK learning
            provider.
          </p>
        </div>
      </div>
    </footer>
  );
}
