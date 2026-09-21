import { useState } from "react";
import { type LiveSession } from "@/lib/live/liveSessions";

/**
 * Which session the WhatsApp reminder is open for, and the number typed into it.
 * Held by the page rather than the modal, so the country prefix is remembered
 * between opens; only the number is cleared.
 */
export function useWhatsAppReminder() {
  const [selectedSession, setSelectedSession] = useState<LiveSession | null>(null);
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  const [phonePrefix, setPhonePrefix] = useState("+44");
  const [phoneNumber, setPhoneNumber] = useState("");

  const openWhatsAppModal = (session: LiveSession) => {
    setSelectedSession(session);
    setIsReminderOpen(true);
    setPhoneNumber("");
  };

  return {
    selectedSession,
    isReminderOpen,
    closeWhatsAppModal: () => setIsReminderOpen(false),
    openWhatsAppModal,
    phonePrefix,
    setPhonePrefix,
    phoneNumber,
    setPhoneNumber,
  };
}
