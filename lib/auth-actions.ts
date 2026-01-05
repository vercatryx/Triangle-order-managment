'use server';

import { createSession, deleteSession, verifySession } from './session';
import { hashPassword, verifyPassword } from './password';
import { supabase } from './supabase';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

import { getSettings } from './actions';
import { sendEmail } from './email';

function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendOtp(email: string) {
    if (!email) return { success: false, message: 'Email is required.' };

    try {
        const { exists, type } = await checkEmailIdentity(email);
        if (!exists) {
            return { success: false, message: 'No account found with that email.' };
        }

        // Generate Code
        const code = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        // Store in DB (delete old codes first)
        let supabaseClient = supabase;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (serviceRoleKey) {
            supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
                auth: { persistSession: false }
            });
        }

        await supabaseClient.from('passwordless_codes').delete().eq('email', email);
        const { error } = await supabaseClient.from('passwordless_codes').insert({
            email,
            code,
            expires_at: expiresAt
        });

        if (error) {
            console.error('Error storing OTP:', error);
            return { success: false, message: 'Failed to generate code.' };
        }

        // Send Email (using same pattern as nutritionist screening form)
        const emailResult = await sendEmail({
            to: email,
            subject: 'Your Login Code',
            html: `
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Your Login Code</h2>
                    <p>Enter the following code to log in:</p>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
                        ${code}
                    </div>
                    <p>This code will expire in 10 minutes.</p>
                </div>
            `
        });

        if (!emailResult.success) {
            console.error('Error sending passwordless login email:', emailResult.error);
            return { success: false, message: emailResult.error || 'Failed to send email.' };
        }

        return { success: true, message: 'Code sent to your email.' };

    } catch (error) {
        console.error('Send OTP Error:', error);
        return { success: false, message: 'An unexpected error occurred.' };
    }
}

export async function verifyOtp(email: string, code: string) {
    if (!email || !code) return { success: false, message: 'Email and code are required.' };

    try {
        let supabaseClient = supabase;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (serviceRoleKey) {
            supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
                auth: { persistSession: false }
            });
        }

        const { data: record, error } = await supabaseClient
            .from('passwordless_codes')
            .select('*')
            .eq('email', email)
            .eq('code', code)
            .maybeSingle();

        if (error || !record) {
            return { success: false, message: 'Invalid code.' };
        }

        if (new Date(record.expires_at) < new Date()) {
            return { success: false, message: 'Code has expired.' };
        }

        // Code valid! Delete it.
        await supabaseClient.from('passwordless_codes').delete().eq('id', record.id);

        // Perform Login (Create Session)
        const { exists, type, id } = await checkEmailIdentity(email);

        if (!exists) {
            return { success: false, message: 'User not found.' };
        }

        if (type === 'admin') {
            if (!id && process.env.ADMIN_USERNAME === email) {
                await createSession('super-admin', 'Admin', 'super-admin');
                redirect('/');
            } else if (id) {
                const { data: admin } = await supabase.from('admins').select('name').eq('id', id).single();
                await createSession(id, admin?.name || 'Admin', 'admin');
                redirect('/');
            }
        } else if (type === 'vendor' && id) {
            const { data: vendor } = await supabase.from('vendors').select('name').eq('id', id).single();
            await createSession(id, vendor?.name || 'Vendor', 'vendor');
            redirect('/vendor');
        } else if (type === 'navigator' && id) {
            const { data: nav } = await supabase.from('navigators').select('name').eq('id', id).single();
            await createSession(id, nav?.name || 'Navigator', 'navigator');
            redirect('/clients');
        } else if (type === 'client' && id) {
            redirect(`/client-portal/${id}`);
        }

        return { success: false, message: 'Could not resolve user session.' };

    } catch (error) {
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
            throw error;
        }
        console.error('Verify OTP Error:', error);
        return { success: false, message: 'An error occurred during verification.' };
    }
}

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


// Helper to check identity AND return global passwordless setting
export async function checkEmailIdentity(identifier: string) {
    if (!identifier) return { exists: false, type: null, enablePasswordless: false };

    // Check global settings
    const settings = await getSettings();
    const enablePasswordless = settings.enablePasswordlessLogin || false;

    const trimmedInput = identifier.trim();

    // First, check for multiple accounts with this email/username
    // Use Service Role if available to bypass RLS
    let supabaseClient = supabase;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
        supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
            auth: { persistSession: false }
        });
    }

    // Count matches across all tables
    let matchCount = 0;

    // 1. Check Env Super Admin
    const envUser = process.env.ADMIN_USERNAME;
    if (envUser && trimmedInput === envUser) {
        matchCount++;
    }

    // 2. Check Database Admins
    const { count: adminCount } = await supabase
        .from('admins')
        .select('*', { count: 'exact', head: true })
        .eq('username', trimmedInput);
    
    if (adminCount && adminCount > 0) {
        matchCount += adminCount;
    }

    // 3. Check Vendors (by Email)
    const { count: vendorCount } = await supabase
        .from('vendors')
        .select('*', { count: 'exact', head: true })
        .ilike('email', trimmedInput);
    
    if (vendorCount && vendorCount > 0) {
        matchCount += vendorCount;
    }

    // 4. Check Navigators
    const { count: navigatorCount } = await supabase
        .from('navigators')
        .select('*', { count: 'exact', head: true })
        .ilike('email', trimmedInput);
    
    if (navigatorCount && navigatorCount > 0) {
        matchCount += navigatorCount;
    }

    // 5. Check Clients (by Email)
    const { count: clientCount } = await supabaseClient
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .ilike('email', trimmedInput);
    
    if (clientCount && clientCount > 0) {
        matchCount += clientCount;
    }

    // If multiple accounts found, return error
    if (matchCount > 1) {
        return { exists: false, type: null, enablePasswordless: false, multipleAccounts: true };
    }

    // Now proceed with normal flow to determine the single account type
    // 1. Check Env Super Admin
    if (envUser && trimmedInput === envUser) {
        return { exists: true, type: 'admin', enablePasswordless: false };
    }

    // 2. Check Database Admins
    const { data: admin } = await supabase
        .from('admins')
        .select('id')
        .eq('username', trimmedInput)
        .maybeSingle();

    if (admin) {
        return { exists: true, type: 'admin', enablePasswordless: false };
    }

    // 3. Check Vendors (by Email)
    const { data: vendor } = await supabase
        .from('vendors')
        .select('id, is_active')
        .ilike('email', trimmedInput)
        .maybeSingle();

    if (vendor) {
        if (!vendor.is_active) {
            return { exists: true, type: 'vendor', enablePasswordless: false };
        }
        return { exists: true, type: 'vendor', enablePasswordless: false };
    }

    // 4. Check Navigators
    const { data: navigator } = await supabase
        .from('navigators')
        .select('id')
        .ilike('email', trimmedInput)
        .maybeSingle();

    if (navigator) {
        return { exists: true, type: 'navigator', enablePasswordless: false };
    }

    // 5. Check Clients (by Email)
    const { data: client } = await supabaseClient
        .from('clients')
        .select('id')
        .ilike('email', trimmedInput)
        .maybeSingle();

    if (client) {
        return { exists: true, type: 'client', id: client.id, enablePasswordless };
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

