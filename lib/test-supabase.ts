import { supabase } from './supabase';

/**
 * Test Supabase connection
 * This is a simple test to verify that the Supabase client is configured correctly
 */
export async function testSupabaseConnection() {
    try {
        // Test basic connection by checking auth status
        const { data, error } = await supabase.auth.getSession();

        if (error) {
            console.error('Supabase connection error:', error);
            return false;
        }

        console.log('✅ Supabase connected successfully!');
        return true;
    } catch (error) {
        console.error('Supabase connection test failed:', error);
        return false;
    }
}
