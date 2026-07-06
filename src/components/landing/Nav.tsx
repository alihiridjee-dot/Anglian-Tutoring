import { Link, useNavigate } from "@tanstack/react-router";
import { GraduationCap, Sparkles, Loader2 } from "lucide-react";
import { useState } from "react";
import { enterDemoMode } from "@/lib/demoAuth";
import { toast } from "sonner";

export function Nav() {
  const navigate = useNavigate();
  const [isDemoLoading, setIsDemoLoading] = useState(false);

  const handleDemoClick = async () => {
    setIsDemoLoading(true);
    toast.loading("Opening interactive demo platform...", { id: "demo-loading" });
    const success = await enterDemoMode();
    if (success) {
      toast.success("Welcome to the Sandbox Demo! Previewing as Student.", { id: "demo-loading" });
      navigate({ to: "/dashboard" });
    } else {
      toast.error("Failed to start demo. Please try standard sign up.", { id: "demo-loading" });
    }
    setIsDemoLoading(false);
  };

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
          <button
            onClick={handleDemoClick}
            disabled={isDemoLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-50 cursor-pointer transition"
          >
            {isDemoLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            )}
            <span className="hidden sm:inline">Demo Platform</span>
            <span className="sm:hidden">Demo</span>
          </button>
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
