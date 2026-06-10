import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("EXPO_PUBLIC_SUPABASE_URL ou EXPO_PUBLIC_SUPABASE_ANON_KEY ausente.");
}

const memoryStorage = new Map<string, string>();
const storage = typeof window === "undefined"
  ? {
      getItem: async (key: string) => memoryStorage.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        memoryStorage.set(key, value);
      },
      removeItem: async (key: string) => {
        memoryStorage.delete(key);
      }
    }
  : AsyncStorage;

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "", {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  },
  realtime: {
    params: {
      eventsPerSecond: 20
    }
  }
});
