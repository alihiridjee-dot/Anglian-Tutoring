interface WelcomeGreetingProps {
  name: string;
  className?: string;
}

export function WelcomeGreeting({ name, className = "" }: WelcomeGreetingProps) {
  return (
    <div className={`flex items-center gap-1.5 relative ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      <p className="text-sm font-medium tracking-wide text-primary-foreground/90">
        Welcome back, <span className="font-bold text-white">{name}</span>!
      </p>
    </div>
  );
}
