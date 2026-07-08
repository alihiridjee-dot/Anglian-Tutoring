import { GraduationCap } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2.5 text-white">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <span className="font-display font-bold tracking-tight">Anglian Learning</span>
        </div>
        <p className="text-xs text-slate-500">
          © {new Date().getFullYear()} Anglian Learning. All rights reserved. Registered UK learning
          provider.
        </p>
      </div>
    </footer>
  );
}
