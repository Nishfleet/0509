// Re-export convenience — import from specific modules for tree-shaking:
// - Client Components: import { createClient } from "@/lib/supabase/client"
// - Server Components: import { createServerSupabaseClient } from "@/lib/supabase/server"
// - Proxy: import { createProxyClient } from "@/lib/supabase/proxy-client"
export { createClient } from "./supabase/client";
