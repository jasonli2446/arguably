'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Bell, Shield, Palette, Globe, Save, X, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import FloatingNav from '@/components/FloatingNav'
import { updateUserProfile, deleteAccount } from '@/lib/actions/user'
import { DEFAULT_PREFERENCES, type UserPreferences } from '@/lib/constants/preferences'

/** Editable user profile payload loaded by the settings server page. */
export interface UserProfile {
  id: string
  username: string
  email: string | null
  realname: string | null
  bio: string | null
  preferences: unknown
  created_at: Date
}

function deepMerge<T extends Record<string, unknown>>(
  defaults: T,
  overrides: Partial<T> | null | undefined
): T {
  if (!overrides) return { ...defaults }
  const result = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    if (key in overrides && overrides[key] !== undefined) {
      if (
        typeof defaults[key] === 'object' &&
        defaults[key] !== null &&
        !Array.isArray(defaults[key])
      ) {
        result[key] = deepMerge(
          defaults[key] as Record<string, unknown>,
          overrides[key] as Record<string, unknown>
        ) as T[keyof T]
      } else {
        result[key] = overrides[key] as T[keyof T]
      }
    }
  }
  return result
}

/** Account settings editor for profile fields, preferences, and account deletion. */
export default function SettingsClient({ profile }: { profile: UserProfile }) {
  const router = useRouter()

  const initialPreferences = useMemo(
    () => deepMerge(DEFAULT_PREFERENCES, profile.preferences as Partial<UserPreferences>),
    [profile.preferences]
  )

  const [username, setUsername] = useState(profile.username)
  const [realname, setRealname] = useState(profile.realname ?? '')
  const [bio, setBio] = useState(profile.bio ?? '')
  const [preferences, setPreferences] = useState<UserPreferences>(initialPreferences)

  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Track original values for dirty check and cancel — updated after successful save
  const [originalData, setOriginalData] = useState({
    username: profile.username,
    realname: profile.realname ?? '',
    bio: profile.bio ?? '',
    preferences: initialPreferences,
  })

  const isDirty = useMemo(() => {
    return (
      username !== originalData.username ||
      realname !== originalData.realname ||
      bio !== originalData.bio ||
      JSON.stringify(preferences) !== JSON.stringify(originalData.preferences)
    )
  }, [username, realname, bio, preferences, originalData])

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await updateUserProfile({ username, realname, bio, preferences })
      setToast({ message: 'Settings saved successfully', type: 'success' })
      setOriginalData({ username, realname, bio, preferences })
      router.refresh()
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to save settings',
        type: 'error',
      })
    } finally {
      setSaving(false)
    }
  }, [username, realname, bio, preferences, router])

  const handleCancel = useCallback(() => {
    setUsername(originalData.username)
    setRealname(originalData.realname)
    setBio(originalData.bio)
    setPreferences(originalData.preferences)
  }, [originalData])

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmText !== profile.username) return
    setDeleting(true)
    try {
      await deleteAccount()
      router.push('/')
      router.refresh()
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to delete account',
        type: 'error',
      })
      setDeleting(false)
      setDeleteDialogOpen(false)
    }
  }, [deleteConfirmText, profile.username, router])

  function updatePreference(
    section: keyof UserPreferences,
    key: string,
    value: string | boolean
  ) {
    setPreferences((prev: UserPreferences) => ({
      ...prev,
      [section]: {
        ...(prev[section] as Record<string, unknown>),
        [key]: value,
      },
    }))
  }

  return (
    <div className="min-h-screen debate-container bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 dark">
      <div className="debate-texture fixed inset-0" />
      <FloatingNav />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-24 left-1/2 -translate-x-1/2 z-50 px-6 py-3 border-2 flex items-center gap-3 ${
              toast.type === 'success'
                ? 'border-green-500/50 bg-green-950/90 text-green-300'
                : 'border-red-500/50 bg-red-950/90 text-red-400'
            }`}
          >
            {toast.type === 'success' ? (
              <Check className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            <span className="debate-mono text-sm">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-2 opacity-70 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative z-10 pt-32 pb-20">
        <div className="container mx-auto px-6 max-w-6xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <h1 className="text-6xl md:text-7xl font-black text-white mb-4">SETTINGS</h1>
            <p className="text-xl text-gray-300">Configure your debate experience</p>
          </motion.div>

          {/* Settings Grid */}
          <div className="grid lg:grid-cols-2 gap-6 mb-8">
            {/* Profile Section */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card className="debate-card h-full">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-red-600 border-2 border-black flex items-center justify-center">
                      <User className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-black text-white">PROFILE</CardTitle>
                      <CardDescription className="text-sm text-gray-400">
                        Manage your account information
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="debate-mono text-xs text-gray-300 font-semibold">
                      Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="debate-input w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="debate-mono text-xs text-gray-300 font-semibold">Email</label>
                    <input
                      type="text"
                      value={profile.email ?? ''}
                      disabled
                      className="debate-input w-full opacity-50 cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="debate-mono text-xs text-gray-300 font-semibold">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={realname}
                      onChange={(e) => setRealname(e.target.value)}
                      className="debate-input w-full"
                      placeholder="Enter your full name"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="debate-mono text-xs text-gray-300 font-semibold">Bio</label>
                    <textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      className="debate-input w-full resize-none"
                      rows={3}
                      maxLength={500}
                      placeholder="Tell others about yourself"
                    />
                    <p className="text-xs text-gray-500 debate-mono">{bio.length}/500</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Notifications Section */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Card className="debate-card h-full">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-red-600 border-2 border-black flex items-center justify-center">
                      <Bell className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-black text-white">NOTIFICATIONS</CardTitle>
                      <CardDescription className="text-sm text-gray-400">
                        Control what you get notified about
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ToggleSetting
                    label="Debate Invitations"
                    value={preferences.notifications.debateInvitations}
                    onChange={(v) => updatePreference('notifications', 'debateInvitations', v)}
                  />
                  <ToggleSetting
                    label="New Messages"
                    value={preferences.notifications.newMessages}
                    onChange={(v) => updatePreference('notifications', 'newMessages', v)}
                  />
                  <ToggleSetting
                    label="Weekly Digest"
                    value={preferences.notifications.weeklyDigest}
                    onChange={(v) => updatePreference('notifications', 'weeklyDigest', v)}
                  />
                </CardContent>
              </Card>
            </motion.div>

            {/* Privacy Section */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Card className="debate-card h-full">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-red-600 border-2 border-black flex items-center justify-center">
                      <Shield className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-black text-white">PRIVACY</CardTitle>
                      <CardDescription className="text-sm text-gray-400">
                        Manage your privacy preferences
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="debate-mono text-xs text-gray-300 font-semibold">
                      Profile Visibility
                    </label>
                    <select
                      value={preferences.privacy.profileVisibility}
                      onChange={(e) =>
                        updatePreference('privacy', 'profileVisibility', e.target.value)
                      }
                      className="debate-input w-full"
                    >
                      <option value="public">Public - Anyone can view</option>
                      <option value="friends">Friends Only</option>
                      <option value="private">Private - Only you</option>
                    </select>
                  </div>
                  <ToggleSetting
                    label="Show Online Status"
                    value={preferences.privacy.showOnlineStatus}
                    onChange={(v) => updatePreference('privacy', 'showOnlineStatus', v)}
                  />
                  <ToggleSetting
                    label="Allow Direct Messages"
                    value={preferences.privacy.allowDirectMessages}
                    onChange={(v) => updatePreference('privacy', 'allowDirectMessages', v)}
                  />
                </CardContent>
              </Card>
            </motion.div>

            {/* Appearance Section */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <Card className="debate-card h-full">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-red-600 border-2 border-black flex items-center justify-center">
                      <Palette className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-black text-white">APPEARANCE</CardTitle>
                      <CardDescription className="text-sm text-gray-400">
                        Customize your interface
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="debate-mono text-xs text-gray-300 font-semibold">Theme</label>
                    <select
                      value={preferences.appearance.theme}
                      onChange={(e) =>
                        updatePreference('appearance', 'theme', e.target.value)
                      }
                      className="debate-input w-full"
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                      <option value="system">System</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="debate-mono text-xs text-gray-300 font-semibold">
                      Font Size
                    </label>
                    <select
                      value={preferences.appearance.fontSize}
                      onChange={(e) =>
                        updatePreference('appearance', 'fontSize', e.target.value)
                      }
                      className="debate-input w-full"
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </div>
                  <ToggleSetting
                    label="Animations"
                    value={preferences.appearance.animations}
                    onChange={(v) => updatePreference('appearance', 'animations', v)}
                  />
                </CardContent>
              </Card>
            </motion.div>

            {/* Language & Region Section */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <Card className="debate-card h-full">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-red-600 border-2 border-black flex items-center justify-center">
                      <Globe className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-xl font-black text-white">
                        LANGUAGE & REGION
                      </CardTitle>
                      <CardDescription className="text-sm text-gray-400">
                        Set your preferences
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="debate-mono text-xs text-gray-300 font-semibold">
                      Language
                    </label>
                    <select
                      value={preferences.language.language}
                      onChange={(e) =>
                        updatePreference('language', 'language', e.target.value)
                      }
                      className="debate-input w-full"
                    >
                      <option value="en">English</option>
                      <option value="es">Espa&#241;ol</option>
                      <option value="fr">Fran&#231;ais</option>
                      <option value="de">Deutsch</option>
                      <option value="pt">Portugu&#234;s</option>
                      <option value="zh">&#20013;&#25991;</option>
                      <option value="ja">&#26085;&#26412;&#35486;</option>
                      <option value="ko">&#54620;&#44397;&#50612;</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="debate-mono text-xs text-gray-300 font-semibold">
                      Time Zone
                    </label>
                    <select
                      value={preferences.language.timezone}
                      onChange={(e) =>
                        updatePreference('language', 'timezone', e.target.value)
                      }
                      className="debate-input w-full"
                    >
                      <option value="America/New_York">Eastern Time (ET)</option>
                      <option value="America/Chicago">Central Time (CT)</option>
                      <option value="America/Denver">Mountain Time (MT)</option>
                      <option value="America/Los_Angeles">Pacific Time (PT)</option>
                      <option value="America/Anchorage">Alaska Time (AKT)</option>
                      <option value="Pacific/Honolulu">Hawaii Time (HT)</option>
                      <option value="Europe/London">London (GMT/BST)</option>
                      <option value="Europe/Paris">Paris (CET/CEST)</option>
                      <option value="Europe/Berlin">Berlin (CET/CEST)</option>
                      <option value="Asia/Tokyo">Tokyo (JST)</option>
                      <option value="Asia/Shanghai">Shanghai (CST)</option>
                      <option value="Asia/Kolkata">Kolkata (IST)</option>
                      <option value="Australia/Sydney">Sydney (AEST/AEDT)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="debate-mono text-xs text-gray-300 font-semibold">
                      Date Format
                    </label>
                    <select
                      value={preferences.language.dateFormat}
                      onChange={(e) =>
                        updatePreference('language', 'dateFormat', e.target.value)
                      }
                      className="debate-input w-full"
                    >
                      <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    </select>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Save / Cancel Buttons */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="flex justify-center gap-4"
          >
            <Button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="debate-button bg-red-600 text-white border-black px-12 py-4 disabled:opacity-50"
            >
              <Save className="w-5 h-5 mr-2" />
              {saving ? 'SAVING...' : 'SAVE CHANGES'}
            </Button>
            <Button
              onClick={handleCancel}
              disabled={!isDirty}
              className="debate-button bg-white text-black border-black px-12 py-4 disabled:opacity-50"
            >
              CANCEL
            </Button>
          </motion.div>

          {/* Danger Zone */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="mt-12"
          >
            <Card className="border-2 border-red-600 bg-red-950/20">
              <CardHeader>
                <CardTitle className="text-2xl font-black text-red-400">DANGER ZONE</CardTitle>
                <CardDescription className="text-gray-400">
                  Irreversible actions - proceed with caution
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-white">Delete Account</h3>
                    <p className="text-sm text-gray-400">
                      Permanently delete your account and all data
                    </p>
                  </div>
                  <Button
                    onClick={() => setDeleteDialogOpen(true)}
                    className="debate-button bg-red-600 text-white border-black"
                  >
                    DELETE
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-red-400">DELETE ACCOUNT</DialogTitle>
            <DialogDescription>
              This action is permanent and cannot be undone. All your data, debate history, and
              settings will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-gray-400">
              Type your username{' '}
              <span className="font-bold text-white">{profile.username}</span> to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="debate-input w-full"
              placeholder="Enter your username"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setDeleteDialogOpen(false)
                setDeleteConfirmText('')
              }}
              className="debate-button bg-white text-black border-black"
            >
              CANCEL
            </Button>
            <Button
              onClick={handleDeleteAccount}
              disabled={deleteConfirmText !== profile.username || deleting}
              className="debate-button bg-red-600 text-white border-black disabled:opacity-50"
            >
              {deleting ? 'DELETING...' : 'PERMANENTLY DELETE'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Reusable toggle switch matching the brutalist debate aesthetic */
function ToggleSetting({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="space-y-2">
      <label className="debate-mono text-xs text-gray-300 font-semibold">{label}</label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={`w-14 h-8 border-2 border-black relative transition-all ${
            value ? 'bg-red-600' : 'bg-gray-600'
          }`}
        >
          <div
            className={`w-6 h-6 bg-white border-2 border-black absolute top-0.5 transition-all ${
              value ? 'left-7' : 'left-0.5'
            }`}
          />
        </button>
        <span className="text-sm text-gray-400">{value ? 'Enabled' : 'Disabled'}</span>
      </div>
    </div>
  )
}
