
import { NextRequest, NextResponse } from 'next/server';
import { decrypt } from '@/lib/session';

// 1. Specify protected and public routes
const protectedRoutes = ['/admin', '/clients', '/billing', '/'];
const vendorRoutes = ['/vendor'];
const publicRoutes = ['/login', '/vendor-login', '/api/auth/login', '/api/process-weekly-orders'];

export default async function middleware(req: NextRequest) {
    // 2. Check if the current route is protected or public
    const path = req.nextUrl.pathname;

    // Exclude static assets/api if needed.
    if (path.startsWith('/_next') || path.startsWith('/static') || path.includes('.')) {
        return NextResponse.next();
    }

    const isPublicRoute = publicRoutes.includes(path);
    const isVendorRoute = vendorRoutes.some(route => path.startsWith(route));
    const isProtectedRoute = protectedRoutes.some(route => path.startsWith(route));

    // 3. Decrypt the session from the cookie
    // In middleware, we must use req.cookies instead of cookies() from next/headers
    const cookie = req.cookies.get('session')?.value;
    const session = await decrypt(cookie || '');

    // 4. Redirect to appropriate login if the user is not authenticated
    if (!isPublicRoute && !session?.userId) {
        // Prevent redirect loop - don't redirect if already on login page
        if (path === '/login' || path === '/vendor-login') {
            return NextResponse.next();
        }
        if (isVendorRoute) {
            return NextResponse.redirect(new URL('/vendor-login', req.url));
        }
        return NextResponse.redirect(new URL('/login', req.url));
    }

    // 5. Redirect if user tries to access wrong portal
    if (session?.userId) {
        // Vendor trying to access admin routes
        if (session.role === 'vendor' && isProtectedRoute) {
            // Prevent redirect loop
            if (path === '/vendor') {
                return NextResponse.next();
            }
            return NextResponse.redirect(new URL('/vendor', req.url));
        }
        // Admin trying to access vendor routes
        if ((session.role === 'admin' || session.role === 'super-admin') && isVendorRoute) {
            // Prevent redirect loop
            if (path === '/clients') {
                return NextResponse.next();
            }
            return NextResponse.redirect(new URL('/clients', req.url));
        }
        // Redirect authenticated users away from login pages
        if (path === '/login' && (session.role === 'admin' || session.role === 'super-admin')) {
            return NextResponse.redirect(new URL('/clients', req.url));
        }
        if (path === '/vendor-login' && session.role === 'vendor') {
            return NextResponse.redirect(new URL('/vendor', req.url));
        }
    }

    return NextResponse.next();
}

// Routes Middleware should not run on
export const config = {
    matcher: ['/((?!_next/static|_next/image|.*\\.png$).*)'],
};
