'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { useAppUser, useAppAuth } from '@/lib/auth-context'

const NAV_LINKS = [
  { label: 'How It Works', href: '#how' },
  { label: 'Platform Features', href: '#features' },
  { label: 'Migration', href: '#migrate' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

export function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { isSignedIn } = useAppUser()
  const { signIn } = useAppAuth()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollTo = (href: string) => {
    setMobileOpen(false)
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <motion.nav
      className="fixed top-0 inset-x-0 z-50 px-4 sm:px-6 pt-3"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div
        className={`max-w-6xl mx-auto flex items-center justify-between rounded-2xl px-4 sm:px-5 py-2.5 transition-all duration-300 ${
          scrolled
            ? 'bg-white/85 backdrop-blur-md border border-slate-200 shadow-sm'
            : 'bg-transparent border border-transparent'
        }`}
      >
        {/* Logo */}
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2.5 group cursor-pointer">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
            DF
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900">
            Dev<span className="text-blue-600">flow</span>
          </span>
        </button>

        {/* Center links */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <button
              key={l.href}
              onClick={() => scrollTo(l.href)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {l.label}
            </button>
          ))}
        </div>

        {/* Right */}
        <div className="hidden md:flex items-center gap-2">
          {isSignedIn ? (
            <Link href="/my-projects" className="px-3.5 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-xs">
              My Projects
            </Link>
          ) : (
            <button
              onClick={() => signIn()}
              className="px-3.5 py-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              Sign In
            </button>
          )}
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden p-2 text-slate-700" onClick={() => setMobileOpen((o) => !o)} aria-label="Menu">
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="md:hidden max-w-6xl mx-auto mt-2 rounded-2xl bg-white border border-slate-200 shadow-xl p-3"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {NAV_LINKS.map((l) => (
              <button
                key={l.href}
                onClick={() => scrollTo(l.href)}
                className="block w-full text-left px-3 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
              >
                {l.label}
              </button>
            ))}
            {isSignedIn ? (
              <Link href="/my-projects" onClick={() => setMobileOpen(false)} className="mt-2 block text-center w-full px-4 py-2.5 text-xs font-semibold bg-blue-600 text-white rounded-lg">
                My Projects
              </Link>
            ) : (
              <button
                onClick={() => {
                  setMobileOpen(false)
                  signIn()
                }}
                className="mt-2 w-full px-4 py-2.5 text-xs font-semibold text-slate-900 bg-slate-100 rounded-lg cursor-pointer"
              >
                Sign In
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
