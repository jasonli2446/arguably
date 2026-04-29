import { createBrowserClient } from "@supabase/ssr";

/** Creates a browser-side Supabase client using public environment variables. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
