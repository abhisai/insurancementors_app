import { createClient } from "@supabase/supabase-js";

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const configuredKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseConfigReady = Boolean(configuredUrl && configuredKey);

function projectUrl(value) {
  return value
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/+$/, "");
}

export const supabase = supabaseConfigReady
  ? createClient(projectUrl(configuredUrl), configuredKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null;
