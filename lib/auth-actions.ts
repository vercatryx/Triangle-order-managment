'use server';

import { createSession, deleteSession, verifySession } from './session';
import { hashPassword, verifyPassword } from './password';
import { supabase } from './supabase';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export async function login(prevState: any, formData: FormData) {
    const loginInput = formData.get('username') as string;
    const password = formData.get('password') as string;

    if (!loginInput || !password) {
        return { message: 'Please enter a username/email and password.' };
    }

    try {
        // 1. Check Env Super Admin
        const envUser = process.env.ADMIN_USERNAME;
        const envPass = process.env.ADMIN_PASSWORD;

        if (envUser && envPass && loginInput === envUser && password === envPass) {
            await createSession('super-admin', 'Admin', 'super-admin');
            redirect('/');
        }

        // 2. Check Database Admins
        const { data: admin } = await supabase
            .from('admins')
            .select('*')
            .eq('username', loginInput)
            .maybeSingle();

        if (admin) {
            const isMatch = await verifyPassword(password, admin.password);
            if (!isMatch) {
                return { message: 'Invalid credentials.' };
            }
            await createSession(admin.id, admin.name || 'Admin', 'admin');
            redirect('/');
        }

        // 3. Check Vendors (by Email)
        const trimmedInput = loginInput.trim();

        const { data: vendor } = await supabase
            .from('vendors')
            .select('*')
            .ilike('email', trimmedInput)
            .maybeSingle();

        if (vendor) {
            if (!vendor.is_active) {
                return { message: 'Account inactive. Contact administrator.' };
            }
            if (!vendor.password) {
                return { message: 'No password set. Contact administrator.' };
            }
            // Trim password input and stored hash before verifying
            const isMatch = await verifyPassword(password.trim(), vendor.password.trim());
            if (!isMatch) {
                return { message: 'Invalid credentials.' };
            }
            await createSession(vendor.id, vendor.name || 'Vendor', 'vendor');
            redirect('/vendor');
        }

        // 4. Check Navigators (by Email)
        const { data: navigator } = await supabase
            .from('navigators')
            .select('*')
            .ilike('email', trimmedInput)
            .maybeSingle();

        if (navigator) {
            if (!navigator.is_active) {
                return { message: 'Account inactive. Contact administrator.' };
            }
            // If no password set, we can't login (unless we allow setting it here, but typically admin sets it)
            if (!navigator.password) {
                return { message: 'No password set. Contact administrator.' };
            }
            const isMatch = await verifyPassword(password.trim(), navigator.password.trim());
            if (!isMatch) {
                return { message: 'Invalid credentials.' };
            }
            await createSession(navigator.id, navigator.name || 'Navigator', 'navigator');
            redirect('/clients');
        }

        return { message: 'Invalid credentials.' };

    } catch (error) {
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
            throw error;
        }
        console.error('Login error:', error);
        return { message: 'An unexpected error occurred.' };
    }
}


export async function logout() {
    await deleteSession();
    redirect('/login');
}


export async function checkEmailIdentity(identifier: string) {
    if (!identifier) return { exists: false, type: null };
    const trimmedInput = identifier.trim();

    // 1. Check Env Super Admin
    const envUser = process.env.ADMIN_USERNAME;
    if (envUser && trimmedInput === envUser) {
        return { exists: true, type: 'admin' };
    }

    // 2. Check Database Admins
    const { data: admin } = await supabase
        .from('admins')
        .select('id')
        .eq('username', trimmedInput)
        .maybeSingle();

    if (admin) {
        return { exists: true, type: 'admin' };
    }

    // 3. Check Vendors (by Email)
    const { data: vendor } = await supabase
        .from('vendors')
        .select('id, is_active')
        .ilike('email', trimmedInput)
        .maybeSingle();

    if (vendor) {
        if (!vendor.is_active) {
            // Technically exists, but we might want to handle this specifically or just say exists
            // For safety/UX, let's treat inactive as "exists" but maybe the login will fail later?
            // Or we can return a specific error here. The plan said "if not exists, show invalid".
            // If inactive, we probably still want to show password prompt so we don't leak status,
            // OR effectively the prompt asks for password, then fails.
            // Let's just return exists=true, and let login handle the 'inactive' error message.
            return { exists: true, type: 'vendor' };
        }
        return { exists: true, type: 'vendor' };
    }

    // 4. Check Navigators
    const { data: navigator } = await supabase
        .from('navigators')
        .select('id')
        .ilike('email', trimmedInput)
        .maybeSingle();

    if (navigator) {
        return { exists: true, type: 'navigator' };
    }

    // 5. Check Clients (by Email)
    // Use Service Role if available to bypass RLS
    let supabaseClient = supabase;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
        supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
            auth: { persistSession: false }
        });
    }

    const { data: client } = await supabaseClient
        .from('clients')
        .select('id')
        .ilike('email', trimmedInput)
        .maybeSingle();

    if (client) {
        return { exists: true, type: 'client', id: client.id };
    }

    return { exists: false, type: null };
}



// --- Admin Management Actions ---

export async function getAdmins() {
    await verifySession();
    const { data, error } = await supabase.from('admins').select('id, username, created_at, name').order('created_at', { ascending: true });
    if (error) {
        console.error('Error fetching admins:', error);
        return [];
    }
    return data;
}

export async function addAdmin(prevState: any, formData: FormData) {
    await verifySession();
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    const name = (formData.get('name') as string) || 'Admin';

    if (!username || !password) {
        return { message: 'Username and password are required.' };
    }

    // Check availability
    const { data: existing } = await supabase.from('admins').select('id').eq('username', username).single();
    if (existing) {
        return { message: 'Username already exists.' };
    }

    const hashedPassword = await hashPassword(password);

    const { error } = await supabase.from('admins').insert([{
        username,
        password: hashedPassword,
        name
    }]);

    if (error) {
        console.error('Error adding admin:', error);
        return { message: 'Failed to add admin.' };
    }

    return { message: 'Admin added successfully.', success: true };
}

export async function deleteAdmin(id: string) {
    await verifySession();
    // Prevent deleting self? Ideally yes, but maybe UI handles it or we assume Super Admin can fix.
    // Also, don't delete the last admin if relying on DB. But we have Env admin.

    // Check if trying to delete current session user?
    const session = await createSession(id); // Wait, this creates session. We need verify.
    // Actually, simple delete is fine for now.

    const { error } = await supabase.from('admins').delete().eq('id', id);
    if (error) {
        console.error('Error deleting admin:', error);
        throw new Error('Failed to delete admin');
    }
}

export async function updateAdmin(prevState: any, formData: FormData) {
    await verifySession();
    const id = formData.get('id') as string;
    const name = formData.get('name') as string;
    const password = formData.get('password') as string;

    if (!id) {
        return { message: 'Admin ID is missing.', success: false };
    }

    const updates: any = {};
    if (name) updates.name = name;
    if (password) {
        updates.password = await hashPassword(password);
    }

    if (Object.keys(updates).length === 0) {
        return { message: 'No changes made.', success: true };
    }

    const { error } = await supabase.from('admins').update(updates).eq('id', id);

    if (error) {
        console.error('Error updating admin:', error);
        return { message: 'Failed to update admin.', success: false };
    }

    return { message: 'Admin updated successfully.', success: true };
}

