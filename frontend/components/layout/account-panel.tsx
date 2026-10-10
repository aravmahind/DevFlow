'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/lib/store'
import { useShallow } from 'zustand/react/shallow'
import { useAppUser, useAppAuth } from '@/lib/auth-context'
import { 
  X, 
  User, 
  Mail, 
  Check, 
  KeyRound, 
  LogOut, 
  Sparkles,
  BarChart2,
  Lock,
  AlertCircle
} from 'lucide-react'

export function AccountPanel() {
  const { accountPanelOpen, setAccountPanelOpen } = useAppStore(useShallow((s) => ({ accountPanelOpen: s.accountPanelOpen, setAccountPanelOpen: s.setAccountPanelOpen })))
  const { user, isClerk } = useAppUser()
  const { signOut, updateProfile } = useAppAuth()
  const isBypassMode = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'

  // Inline edit state for mock user
  const [isEditing, setIsEditing] = useState(false)
  const [firstName, setFirstName] = useState(user?.firstName || '')
  const [lastName, setLastName] = useState(user?.lastName || '')
  const [email, setEmail] = useState(user?.primaryEmailAddress?.emailAddress || '')

  const handleSave = () => {
    updateProfile(firstName, lastName, email)
    setIsEditing(false)
  }

  const handleSignOut = () => {
    signOut()
    setAccountPanelOpen(false)
  }

  return (
    <AnimatePresence>
      {accountPanelOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setAccountPanelOpen(false)}
          />

          {/* Sliding Panel */}
          <motion.div
            className="fixed right-0 top-0 h-screen w-full sm:w-[420px] bg-white border-l border-slate-200 shadow-2xl z-50 p-6 flex flex-col justify-between overflow-y-auto"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          >
            {/* Upper Content */}
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <User className="w-4 h-4" />
                  </div>
                  <h2 className="text-base font-bold text-slate-900">
                    Account Profile
                  </h2>
                </div>
                <button
                  onClick={() => setAccountPanelOpen(false)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* User Avatar & Info Card */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <img
                  src={user?.imageUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces'}
                  alt={user?.fullName || 'User'}
                  className="w-14 h-14 rounded-xl object-cover border border-slate-200 shadow-xs"
                />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-900">
                      {user?.fullName || 'Demo Engineer'}
                    </h3>
                    <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                      PRO
                    </span>
                    {isBypassMode && (
                      <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                        DEMO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {user?.primaryEmailAddress?.emailAddress || 'engineer@devflow.ai'}
                  </p>
                </div>
              </div>

              {/* Account Details */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Profile Information
                  </h4>
                  {!isClerk && (
                    <button
                      onClick={() => setIsEditing(!isEditing)}
                      className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                    >
                      {isEditing ? 'Cancel' : 'Edit Details'}
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-slate-500 block mb-1">First Name</label>
                    <input
                      type="text"
                      disabled={!isEditing || isClerk}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full text-xs bg-slate-50 disabled:bg-slate-50/50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-500 block mb-1">Last Name</label>
                    <input
                      type="text"
                      disabled={!isEditing || isClerk}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full text-xs bg-slate-50 disabled:bg-slate-50/50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-500 block mb-1">Email Address</label>
                    <input
                      type="email"
                      disabled={!isEditing || isClerk}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full text-xs bg-slate-50 disabled:bg-slate-50/50 border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {isEditing && (
                    <button
                      onClick={handleSave}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
                    >
                      Save Changes
                    </button>
                  )}
                </div>
              </div>

              {/* Usage Stats Card */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-xs">
                  <BarChart2 className="w-4 h-4 text-blue-600" />
                  <span>Workspace AI Usage</span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Generated Projects</span>
                    <span className="font-semibold text-slate-900">12 / 50</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full w-[24%]" />
                  </div>
                </div>
              </div>

              {/* Demo Mode Info */}
              {isBypassMode && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-left">
                    <p className="text-[11px] font-semibold text-amber-900">Demo Mode</p>
                    <p className="text-[10px] text-amber-700 mt-0.5">
                      You're using a mock account. Real authentication requires Clerk setup.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="pt-6 border-t border-slate-100">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-slate-200 hover:border-rose-200 bg-slate-50 hover:bg-rose-50 text-slate-700 hover:text-rose-600 text-xs font-semibold transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
