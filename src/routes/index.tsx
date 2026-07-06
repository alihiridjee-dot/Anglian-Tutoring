import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { TutorsSection } from "@/components/landing/TutorsSection";
import { OfferSection } from "@/components/landing/OfferSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { ContactSection } from "@/components/landing/ContactSection";
import { Footer } from "@/components/landing/Footer";
import { FloatingWhatsApp } from "@/components/landing/FloatingWhatsApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anglian Tutoring — Live Science Tutoring" },
      {
        name: "description",
        content:
          "Live online Biology, Chemistry and Physics tutoring with Dr Nadia and Ali. Weekly quizzes, homework marking, and a real grade predictor. Book a place today.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [selectedLevel, setSelectedLevel] = useState("gcse_triple");

  return (
    <div className="min-h-screen bg-slate-50/40 text-slate-900 font-sans antialiased">
      <Nav />
      <Hero />
      <TutorsSection />
      <OfferSection />
      <PricingSection selectedLevel={selectedLevel} setSelectedLevel={setSelectedLevel} />
      <ContactSection />
      <Footer />
      <FloatingWhatsApp />
    </div>
  );
}
