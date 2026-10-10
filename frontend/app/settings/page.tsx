'use client'

import { useEffect, useState } from 'react'
import { TopNavbar } from '@/components/layout/top-navbar'
import { AccountPanel } from '@/components/layout/account-panel'
import { useAppUser } from '@/lib/auth-context'
import { updateMyRole, syncUser } from '@/lib/api'
import { Loader2, Save, User, Code, ShieldCheck, CheckCircle2, Info, Github } from 'lucide-react'
import { GithubAccountCard, useGithubAccount } from '@/components/github/github-account'

const SPECIALIZATIONS = [
  'Full Stack', 'Frontend', 'Backend', 'Mobile', 'DevOps', 'Security',
  'Data Engineering', 'Machine Learning',
  'QA Automation', 'Manual Testing', 'Performance Testing',
  'TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C++', 'C#',
  'Ruby', 'Swift', 'Kotlin', 'PHP', 'Scala',
]

export default function SettingsPage() {
  const { user, isLoaded, isSignedIn } = useAppUser()
  const [specialization, setSpecialization] = useState('')
  const [saving, setSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    if (user?.specialization) setSpecialization(user.specialization)
  }, [user])

  if (!isLoaded) return <div className="min-h-screen bg-slate-50" />

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-500">Please sign in to access settings.</p>
      </div>
    )
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    setSuccessMessage('')
    try {
      await updateMyRole('developer', specialization || undefined)
      // Force sync to update context
      await syncUser({
        clerk_id: user.id,
        email: user.primaryEmailAddress.emailAddress,
        first_name: user.firstName,
        last_name: user.lastName,
        image_url: user.imageUrl,
      })
      setSuccessMessage('Profile settings saved successfully.')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err) {
      console.error(err)
      alert('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      <TopNavbar />
      <AccountPanel />
      <main className="flex-1 overflow-y-auto pt-24 pb-16 px-4 sm:px-6 max-w-4xl mx-auto w-full">
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Account Settings
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Manage your personal profile and engineering preferences.
            </p>
          </div>

          <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-600" /> My Profile
              </h3>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex items-center gap-4">
                <img
                  src={user?.imageUrl}
                  alt={user?.fullName || 'User avatar'}
                  className="w-16 h-16 rounded-full border border-slate-200 object-cover"
                />
                <div>
                  <p className="font-bold text-slate-900 text-base">{user?.fullName || 'Anonymous'}</p>
                  <p className="text-sm text-slate-500">{user?.primaryEmailAddress?.emailAddress}</p>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-1 flex items-center gap-2">
                    <Code className="w-4 h-4 text-slate-500" /> Primary Skill / Specialization
                  </label>
                  <p className="text-xs text-slate-500 mb-3">
                    Your default specialization when collaborating on projects and sprint boards.
                  </p>
                  <select
                    value={specialization}
                    onChange={(e) => setSpecialization(e.target.value)}
                    className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    <option value="">No Specialization (General)</option>
                    {SPECIALIZATIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Role Model Explanation Box */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start gap-3 mt-4">
                  <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-600 leading-relaxed">
                    <p className="font-semibold text-slate-900 mb-1">How roles work in Devflow</p>
                    <p>
                      Roles are <strong>project-specific</strong>. When you create a project, you automatically become its <strong>Manager</strong>.
                      For projects you are invited to, the project manager assigns your role (Manager, Developer, or Tester) and specialization.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <div>
                {successMessage && (
                  <p className="text-sm font-semibold text-emerald-600 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> {successMessage}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          </form>

          <ConnectedAccounts />
        </div>
      </main>
    </div>
  )
}

function ConnectedAccounts() {
  const { status, error, refresh } = useGithubAccount()
  return (
    <section className="mt-6 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
      <div className="p-6 border-b border-slate-100">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Github className="w-4 h-4" /> Connected accounts
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Link private repositories to your projects through your GitHub account.
        </p>
      </div>
      <div className="p-6">
        {error && <p className="text-xs text-rose-700">{error}</p>}
        {!status && !error && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        {status && <GithubAccountCard status={status} returnTo="/settings" onChanged={refresh} />}
      </div>
    </section>
  )
}
