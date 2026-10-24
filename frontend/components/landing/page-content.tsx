'use client'

import { motion, useScroll, useSpring } from 'framer-motion'
import { LandingNavbar } from './navbar'
import { HeroSection } from './hero-section'
import { TrustBar } from './trust-bar'
import { ProblemSection } from './problem-section'
import { HowItWorks } from './how-it-works'
import { AgentsShowcase } from './agents-showcase'
import { InputSection } from './input-section'
import { FeaturesSection } from './features-section'
import { MigrationSection } from './migration-section'
import { SocialProof } from './social-proof'
import { FaqSection } from './faq-section'
import { FinalCta } from './final-cta'
import { LandingFooter } from './footer'

export function LandingPageContent() {
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 })

  return (
    <div className="relative min-h-screen bg-background overflow-x-clip">
      {/* Scroll progress bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 z-[60] h-0.5 origin-left bg-slate-950"
        style={{ scaleX: progress }}
      />

      {/* Ambient background: aurora blobs + blueprint grid */}
      <div className="fixed inset-0 -z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-grid bg-grid-fade opacity-60" />
        <motion.div
          className="absolute -top-32 left-1/4 w-[40rem] h-[40rem] rounded-full bg-primary/12 blur-[120px] animate-aurora"
        />
        <motion.div
          className="absolute top-1/3 -right-32 w-[36rem] h-[36rem] rounded-full bg-secondary/12 blur-[120px] animate-aurora"
          style={{ animationDelay: '-6s' }}
        />
        <motion.div
          className="absolute bottom-0 left-0 w-[32rem] h-[32rem] rounded-full bg-signal/15 blur-[120px] animate-aurora"
          style={{ animationDelay: '-12s' }}
        />
      </div>

      <div className="relative z-10">
        <LandingNavbar />
        <main>
          <HeroSection />
          <InputSection />
          <TrustBar />
          <ProblemSection />
          <HowItWorks />
          <AgentsShowcase />
          <FeaturesSection />
          <MigrationSection />
          <SocialProof />
          <FaqSection />
          <FinalCta />
        </main>
        <LandingFooter />
      </div>
    </div>
  )
}
