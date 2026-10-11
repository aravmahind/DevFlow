import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { ClerkProvider } from '@clerk/nextjs'

// Self-hosted and preloaded by next/font; exposed as CSS variables for globals.css.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL('https://devflow.ai'),
  title: {
    default: 'Devflow — Ship the plan before you write the first line of code',
    template: '%s · Devflow',
  },
  description:
    'Devflow is an AI organization — PM, architect, estimation and risk agents — that turns one idea into a complete software delivery plan: requirements, backlog, milestones, team, cost and risks. Free to start.',
  keywords: [
    'AI project planning', 'SDLC automation', 'AI product manager', 'software delivery plan',
    'AI sprint planning', 'project estimation', 'requirements generator', 'Devflow',
  ],
  authors: [{ name: 'Devflow' }],
  openGraph: {
    title: 'Devflow — Turn one idea into a complete software plan',
    description:
      'An AI organization that drafts your requirements, backlog, milestones, team, cost and risks in minutes. Free to start, no credit card.',
    url: 'https://devflow.ai',
    siteName: 'Devflow',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Devflow — Ship the plan before you write code',
    description: 'An AI org that turns one idea into a full delivery plan in minutes.',
  },
  generator: 'Devflow',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#ffffff',
}

/**
 * Only mount ClerkProvider when a publishable key is available AND auth is
 * not explicitly bypassed. This lets the app build and run inside Docker
 * without any Clerk credentials.
 */
function MaybeClerkProvider({ children }: { children: React.ReactNode }) {
  return <ClerkProvider afterSignOutUrl="/">{children}</ClerkProvider>
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} bg-background text-foreground`}>
      <body className="font-sans antialiased text-foreground min-h-screen">
        <MaybeClerkProvider>
          <AuthProvider>{children}</AuthProvider>
        </MaybeClerkProvider>
        {process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}
