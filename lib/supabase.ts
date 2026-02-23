import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Shared options when creating Supabase clients (e.g. for server-side/service role). */
export const supabaseClientOptions: Parameters<typeof createClient>[2] = {};

export const supabase = createClient(supabaseUrl, supabaseKey);
