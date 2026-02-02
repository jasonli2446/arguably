'use client'

import { motion } from 'framer-motion'
import { User, Bell, Shield, Palette, Volume2, Globe, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import FloatingNav from '@/components/FloatingNav'

export default function SettingsPage() {
  const settingsSections = [
    {
      icon: User,
      title: "PROFILE",
      description: "Manage your account information",
      settings: [
        { label: "Username", type: "input", value: "debater_247" },
        { label: "Email", type: "input", value: "user@arguably.com" },
        { label: "Bio", type: "textarea", value: "Professional truth-seeker" },
      ]
    },
    {
      icon: Bell,
      title: "NOTIFICATIONS",
      description: "Control what you get notified about",
      settings: [
        { label: "Debate Invitations", type: "toggle", value: true },
        { label: "New Messages", type: "toggle", value: true },
        { label: "Weekly Digest", type: "toggle", value: false },
      ]
    },
    {
      icon: Shield,
      title: "PRIVACY",
      description: "Manage your privacy preferences",
      settings: [
        { label: "Profile Visibility", type: "select", value: "public" },
        { label: "Show Online Status", type: "toggle", value: true },
        { label: "Allow Direct Messages", type: "toggle", value: true },
      ]
    },
    {
      icon: Volume2,
      title: "AUDIO",
      description: "Audio and microphone settings",
      settings: [
        { label: "Microphone", type: "select", value: "Default" },
        { label: "Speaker", type: "select", value: "Default" },
        { label: "Background Noise Suppression", type: "toggle", value: true },
      ]
    },
    {
      icon: Palette,
      title: "APPEARANCE",
      description: "Customize your interface",
      settings: [
        { label: "Theme", type: "select", value: "dark" },
        { label: "Font Size", type: "select", value: "medium" },
        { label: "Animations", type: "toggle", value: true },
      ]
    },
    {
      icon: Globe,
      title: "LANGUAGE & REGION",
      description: "Set your preferences",
      settings: [
        { label: "Language", type: "select", value: "English" },
        { label: "Time Zone", type: "select", value: "UTC-5" },
        { label: "Date Format", type: "select", value: "MM/DD/YYYY" },
      ]
    },
  ]

  return (
    <div className="min-h-screen debate-container bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 dark">
      <div className="debate-texture fixed inset-0" />
      <FloatingNav />

      <main className="relative z-10 pt-32 pb-20">
        <div className="container mx-auto px-6 max-w-6xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <h1 className="text-6xl md:text-7xl font-black text-white mb-4">
              SETTINGS
            </h1>
            <p className="text-xl text-gray-300">
              Configure your debate experience
            </p>
          </motion.div>

          {/* Settings Grid */}
          <div className="grid lg:grid-cols-2 gap-6 mb-8">
            {settingsSections.map((section, sectionIndex) => (
              <motion.div
                key={section.title}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + sectionIndex * 0.1 }}
              >
                <Card className="debate-card h-full">
                  <CardHeader>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-10 h-10 bg-red-600 border-2 border-black flex items-center justify-center">
                        <section.icon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-xl font-black text-white">
                          {section.title}
                        </CardTitle>
                        <CardDescription className="text-sm text-gray-400">
                          {section.description}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {section.settings.map((setting, settingIndex) => (
                      <div key={settingIndex} className="space-y-2">
                        <label className="debate-mono text-xs text-gray-300 font-semibold">
                          {setting.label}
                        </label>
                        {setting.type === 'input' && (
                          <input
                            type="text"
                            defaultValue={setting.value as string}
                            className="debate-input w-full"
                          />
                        )}
                        {setting.type === 'textarea' && (
                          <textarea
                            defaultValue={setting.value as string}
                            className="debate-input w-full resize-none"
                            rows={3}
                          />
                        )}
                        {setting.type === 'select' && (
                          <select
                            defaultValue={setting.value as string}
                            className="debate-input w-full"
                          >
                            <option>{setting.value}</option>
                            <option>Option 2</option>
                            <option>Option 3</option>
                          </select>
                        )}
                        {setting.type === 'toggle' && (
                          <div className="flex items-center gap-3">
                            <button
                              className={`w-14 h-8 border-2 border-black relative transition-all ${
                                setting.value ? 'bg-red-600' : 'bg-gray-600'
                              }`}
                            >
                              <div
                                className={`w-6 h-6 bg-white border-2 border-black absolute top-0.5 transition-all ${
                                  setting.value ? 'left-7' : 'left-0.5'
                                }`}
                              />
                            </button>
                            <span className="text-sm text-gray-400">
                              {setting.value ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Save Button */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="flex justify-center gap-4"
          >
            <Button className="debate-button bg-red-600 text-white border-black px-12 py-4">
              <Save className="w-5 h-5 mr-2" />
              SAVE CHANGES
            </Button>
            <Button className="debate-button bg-white text-black border-black px-12 py-4">
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
                <CardTitle className="text-2xl font-black text-red-400">
                  DANGER ZONE
                </CardTitle>
                <CardDescription className="text-gray-400">
                  Irreversible actions - proceed with caution
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-white">Delete Account</h3>
                    <p className="text-sm text-gray-400">Permanently delete your account and all data</p>
                  </div>
                  <Button className="debate-button bg-red-600 text-white border-black">
                    DELETE
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
