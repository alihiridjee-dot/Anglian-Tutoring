import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { TutorsSection } from "@/components/landing/TutorsSection";
import { OfferSection } from "@/components/landing/OfferSection";
import { CurriculumShowcase } from "@/components/landing/CurriculumShowcase";
import { PricingSection } from "@/components/landing/PricingSection";
import { ContactSection } from "@/components/landing/ContactSection";
import { Footer } from "@/components/landing/Footer";
import { FloatingWhatsApp } from "@/components/landing/FloatingWhatsApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anglia Educate — Live Science Tutoring" },
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
  return (
    <div className="min-h-screen bg-secondary/40 text-foreground font-sans antialiased">
      <Nav />
      <Hero />
      <TutorsSection />
      <CurriculumShowcase />
      <OfferSection />
      <PricingSection />
      <ContactSection />
      <Footer />
      <FloatingWhatsApp />
    </div>
  );
}
