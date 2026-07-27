import { Link } from "@tanstack/react-router";
import { GraduationCap, Sparkles } from "lucide-react";

export function Nav() {
  return (
    <header className="glass-bar sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" hash="top" className="flex items-center gap-2.5 group">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shadow-[0_8px_16px_-8px_var(--primary)] transition-transform group-hover:scale-105"
            style={{ background: "var(--gradient-hero)" }}
          >
            <GraduationCap className="w-5.5 h-5.5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-foreground">
            Anglia Educate
          </span>
        </Link>
        {/* Section links route back to the landing page by path + hash, so they
            work from standalone pages (e.g. /how-it-works) as well as from "/". */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-muted-foreground">
          <Link to="/" hash="tutors" className="hover:text-primary transition">
            Our Tutors
          </Link>
          <Link
            to="/how-it-works"
            className="hover:text-primary transition"
            activeProps={{ className: "text-primary" }}
          >
            How it works
          </Link>
          <Link to="/" hash="offer" className="hover:text-primary transition">
            What we offer
          </Link>
          <Link to="/" hash="pricing" className="hover:text-primary transition">
            Pricing
          </Link>
          <Link to="/" hash="contact" className="hover:text-primary transition">
            Contact
          </Link>
        </nav>
        <div className="flex items-center gap-2.5">
          <Link
            to="/demo"
            className="btn-soft inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-warning" />
            <span className="hidden sm:inline">Demo Platform</span>
            <span className="sm:hidden">Demo</span>
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signin" } as never}
            className="px-3 py-2 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition"
          >
            Login
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signup" } as never}
            className="btn-premium px-4 py-2 rounded-xl text-sm font-semibold"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
