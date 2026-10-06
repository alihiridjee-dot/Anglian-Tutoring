import { MessageSquare } from "lucide-react";
import { whatsappLink } from "@/lib/leads/whatsapp";

export function FloatingWhatsApp() {
  return (
    <a
      href={whatsappLink()}
      target="_blank"
      rel="noreferrer"
      aria-label="Contact us on WhatsApp"
      // Fixed, so it misses the body's notch padding: it clears the home
      // indicator and, on a phone turned sideways, the notch itself.
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:right-[max(1.5rem,env(safe-area-inset-right))] z-40 bg-[#25D366] text-white p-3.5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center justify-center border border-[#1ebd5b]"
    >
      <MessageSquare className="w-6 h-6 fill-white" />
    </a>
  );
}
