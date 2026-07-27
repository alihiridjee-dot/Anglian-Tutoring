import { Link } from "@tanstack/react-router";
import { GraduationCap, Sparkles } from "lucide-react";

export function Nav() {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" hash="top" className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-slate-900 to-slate-800 flex items-center justify-center shadow-sm">
            <GraduationCap className="w-5.5 h-5.5 text-white" />
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-slate-900">
            Anglian Learning
          </span>
        </Link>
        {/* Section links route back to the landing page by path + hash, so they
            work from standalone pages (e.g. /how-it-works) as well as from "/". */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-500">
          <Link to="/" hash="tutors" className="hover:text-slate-900 transition">
            Our Tutors
          </Link>
          <Link
            to="/how-it-works"
            className="hover:text-slate-900 transition"
            activeProps={{ className: "text-slate-900" }}
          >
            How it works
          </Link>
          <Link to="/" hash="offer" className="hover:text-slate-900 transition">
            What we offer
          </Link>
          <Link to="/" hash="pricing" className="hover:text-slate-900 transition">
            Pricing
          </Link>
          <Link to="/" hash="contact" className="hover:text-slate-900 transition">
            Contact
          </Link>
        </nav>
        <div className="flex items-center gap-2.5">
          <Link
            to="/demo"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 cursor-pointer transition"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden sm:inline">Demo Platform</span>
            <span className="sm:hidden">Demo</span>
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signin" } as never}
            className="px-3 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition"
          >
            Login
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signup" } as never}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
