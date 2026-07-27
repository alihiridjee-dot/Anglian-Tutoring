import { Link } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";

export function Footer() {
  return (
    <footer
      className="py-12 text-primary-foreground/70"
      style={{
        background:
          "linear-gradient(135deg, var(--primary-deep), color-mix(in oklab, var(--accent) 30%, var(--primary-deep)))",
      }}
    >
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2.5 text-primary-foreground">
          <div className="w-9 h-9 rounded-xl bg-white/15 ring-1 ring-white/20 flex items-center justify-center">
            <GraduationCap className="w-5 h-5" />
          </div>
          <span className="font-display font-bold tracking-tight">Anglia Educate</span>
        </div>
        {/* The nav bar's section links are desktop-only, so the footer carries
            the standalone pages for mobile visitors. */}
        <nav className="flex items-center gap-6 text-sm font-medium">
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
        <p className="text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} Anglia Educate. All rights reserved. Registered UK learning
          provider.
        </p>
      </div>
    </footer>
  );
}
