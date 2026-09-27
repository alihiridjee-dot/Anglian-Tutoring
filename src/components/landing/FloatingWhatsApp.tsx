import { MessageSquare } from "lucide-react";
import { whatsappLink } from "@/lib/leads/whatsapp";

export function FloatingWhatsApp() {
  return (
    <a
      href={whatsappLink()}
      target="_blank"
      rel="noreferrer"
      aria-label="Contact us on WhatsApp"
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 sm:bottom-6 sm:right-6 z-40 bg-[#25D366] text-white p-3.5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center justify-center border border-[#1ebd5b]"
    >
      <MessageSquare className="w-6 h-6 fill-white" />
    </a>
  );
}
