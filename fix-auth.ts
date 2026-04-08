const fs = require('fs');

// 1. Fix lib/supabase.ts
let supabaseTs = fs.readFileSync('lib/supabase.ts', 'utf8');
supabaseTs = supabaseTs.replace("import * as SecureStore from 'expo-secure-store';", "import * as SecureStore from 'expo-secure-store';\n\nconst ExpoSecureStoreAdapter = {\n  getItem: (key: string) => SecureStore.getItemAsync(key),\n  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),\n  removeItem: (key: string) => SecureStore.deleteItemAsync(key),\n};");
supabaseTs = supabaseTs.replace('storage: AsyncStorage,', 'storage: ExpoSecureStoreAdapter,');
fs.writeFileSync('lib/supabase.ts', supabaseTs);

// 2. Fix lib/auth-context.tsx (handle missing AsyncStorage)
let authCtx = fs.readFileSync('lib/auth-context.tsx', 'utf8');
// remove the getAllKeys and multiRemove logic because SecureStore doesn't support it.
// we just let supabase.auth.signOut handle it.
authCtx = authCtx.replace(/const keys = await AsyncStorage\.getAllKeys\(\);\s*const authKeys = keys\.filter.*?\n\s*if \(authKeys\.length\) await AsyncStorage\.multiRemove\(authKeys\);/s, "// SecureStore manages its own isolated keys, relying purely on signOut now.");
fs.writeFileSync('lib/auth-context.tsx', authCtx);

// 3. Fix lib/notifications-context.tsx
let notifCtx = fs.readFileSync('lib/notifications-context.tsx', 'utf8');
notifCtx = notifCtx.replace(/import AsyncStorage.*?\n/s, "import * as SecureStore from 'expo-secure-store';\n");
fs.writeFileSync('lib/notifications-context.tsx', notifCtx);

console.log("Fixed lib adapters");
