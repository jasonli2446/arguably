import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const authFile = path.join(__dirname, '..', '.playwright', '.auth', 'user.json')

setup('authenticate', async ({ page }) => {
  // Read env vars (Playwright doesn't always forward NEXT_PUBLIC_* vars)
  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  let supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    const envFiles = ['.env.local', '.env']
    for (const envFile of envFiles) {
      try {
        const content = await fs.promises.readFile(path.join(__dirname, '..', envFile), 'utf-8')
        if (!supabaseUrl) supabaseUrl = content.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim()
        if (!supabaseKey) supabaseKey = content.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim()
      } catch { /* file doesn't exist */ }
    }
  }

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  // Step 1: Get auth tokens via Supabase REST API
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: process.env.TEST_USER_EMAIL!,
      password: process.env.TEST_USER_PASSWORD!,
    }),
  })

  const session = await res.json()
  if (!session.access_token) {
    throw new Error(`Supabase login failed: ${JSON.stringify(session)}`)
  }

  // Step 2: Extract project ref from URL for cookie name
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`

  // Step 3: Build the session cookie value (@supabase/ssr stores session as JSON in cookies)
  const sessionValue = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
    user: session.user,
  })

  // Step 4: Set cookies via Playwright context (chunked if needed, matching @supabase/ssr format)
  const CHUNK_SIZE = 3180
  if (sessionValue.length <= CHUNK_SIZE) {
    await page.context().addCookies([{
      name: cookieName,
      value: sessionValue,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    }])
  } else {
    // Chunk the value for large sessions
    const chunks: string[] = []
    for (let i = 0; i < sessionValue.length; i += CHUNK_SIZE) {
      chunks.push(sessionValue.slice(i, i + CHUNK_SIZE))
    }
    const cookies = chunks.map((chunk, i) => ({
      name: `${cookieName}.${i}`,
      value: chunk,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    }))
    await page.context().addCookies(cookies)
  }

  // Step 5: Navigate to a protected page to verify auth works
  await page.goto('/browse')
  await expect(page).toHaveURL('/browse', { timeout: 10000 })

  // Step 6: Save authenticated state
  await page.context().storageState({ path: authFile })
})
