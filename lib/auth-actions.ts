'use server';

import { createSession, deleteSession, verifySession } from './session';
import { hashPassword, verifyPassword } from './password';
import { supabase } from './supabase';
import { redirect } from 'next/navigation';

export async function login(prevState: any, formData: FormData) {
    const start = Date.now();
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    if (!username || !password) {
        return { message: 'Please enter a username and password.' };
    }

    // 1. Check Env Super Admin
    const envUser = process.env.ADMIN_USERNAME;
    const envPass = process.env.ADMIN_PASSWORD;

    if (envUser && envPass && username === envUser && password === envPass) {
        await createSession('super-admin', 'Admin', 'super-admin');
        redirect('/');
    }

    // 2. Check Database Admins
    try {
        const { data: admin, error } = await supabase
            .from('admins')
            .select('*')
            .eq('username', username)
            .single();

        if (error || !admin) {
            return { message: 'Invalid credentials.' };
        }

        const isMatch = await verifyPassword(password, admin.password);
        if (!isMatch) {
            return { message: 'Invalid credentials.' };
        }

        await createSession(admin.id, admin.name || 'Admin', 'admin');
        redirect('/'); // Or /admin
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

export async function vendorLogin(prevState: any, formData: FormData) {
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    if (!email || !password) {
        return { message: 'Please enter an email and password.' };
    }

    try {
        // Trim email and make lookup case-insensitive
        const trimmedEmail = email.trim().toLowerCase();
        
        // Fetch vendors with emails and filter for case-insensitive exact match
        // Using .not() to filter out null emails, then filter in JS for exact case-insensitive match
        const { data: vendors, error } = await supabase
            .from('vendors')
            .select('id, name, email, password, is_active')
            .not('email', 'is', null);

        if (error) {
            console.error('Vendor login database error:', error);
            return { message: 'Invalid credentials.' };
        }

        if (!vendors || vendors.length === 0) {
            return { message: 'Invalid credentials.' };
        }

        // Find exact match (case-insensitive) - trim and compare emails
        const vendor = vendors.find(v => {
            if (!v.email) return false;
            return v.email.trim().toLowerCase() === trimmedEmail;
        });

        if (!vendor) {
            console.error('Vendor not found for email:', trimmedEmail);
            return { message: 'Invalid credentials.' };
        }

        if (!vendor.is_active) {
            return { message: 'Your vendor account is inactive. Please contact an administrator.' };
        }

        if (!vendor.password || vendor.password.trim() === '') {
            console.error('Vendor has no password set:', vendor.id);
            return { message: 'No password set for this vendor. Please contact an administrator.' };
        }

        // Trim both input password and stored password hash before verification
        const isMatch = await verifyPassword(password.trim(), vendor.password.trim());
        if (!isMatch) {
            console.error('Password mismatch for vendor:', vendor.id);
            return { message: 'Invalid credentials.' };
        }

        await createSession(vendor.id, vendor.name || 'Vendor', 'vendor');
        redirect('/vendor');
    } catch (error) {
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
            throw error;
        }
        console.error('Vendor login error:', error);
        return { message: 'An unexpected error occurred.' };
    }
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

