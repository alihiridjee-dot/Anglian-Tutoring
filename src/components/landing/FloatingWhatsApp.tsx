import { MessageSquare } from "lucide-react";

export function FloatingWhatsApp() {
  return (
    <a
      href="https://wa.me/447530863009"
      target="_blank"
      rel="noreferrer"
      aria-label="Contact us on WhatsApp"
      className="fixed bottom-6 right-6 z-40 bg-[#25D366] text-white p-3.5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center justify-center border border-[#1ebd5b]"
    >
      <MessageSquare className="w-6 h-6 fill-white" />
    </a>
  );
}
