import { Link } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";

export function Nav() {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-slate-900 to-slate-800 flex items-center justify-center shadow-sm">
            <GraduationCap className="w-5.5 h-5.5 text-white" />
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-slate-900">
            Anglian Tutoring
          </span>
        </a>
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-500">
          <a href="#tutors" className="hover:text-slate-900 transition">
            Our Tutors
          </a>
          <a href="#offer" className="hover:text-slate-900 transition">
            What we offer
          </a>
          <a href="#pricing" className="hover:text-slate-900 transition">
            Pricing
          </a>
          <a href="#contact" className="hover:text-slate-900 transition">
            Contact
          </a>
        </nav>
        <div className="flex items-center gap-2.5">
          <Link
            to="/auth"
            search={{ mode: "signin" } as never}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition"
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
