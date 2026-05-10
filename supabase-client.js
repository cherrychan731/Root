window.SUPABASE_CONFIG = window.DSE_SUPABASE_CONFIG || null;

window.supabaseClient = window.SUPABASE_CONFIG && window.supabase
  ? window.supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.publishableKey
  )
  : null;
