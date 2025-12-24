
import { NextRequest, NextResponse } from 'next/server';
import { decrypt } from '@/lib/session';
import { cookies } from 'next/headers';

// 1. Specify protected and public routes
const protectedRoutes = ['/admin', '/clients', '/billing', '/'];
const publicRoutes = ['/login', '/api/auth/login'];

export default async function middleware(req: NextRequest) {
    // 2. Check if the current route is protected or public
    const path = req.nextUrl.pathname;

    // Exclude static assets/api if needed.
    if (path.startsWith('/_next') || path.startsWith('/static') || path.includes('.')) {
        return NextResponse.next();
    }

    const isPublicRoute = publicRoutes.includes(path);

    // 3. Decrypt the session from the cookie
    const cookie = (await cookies()).get('session')?.value;
    const session = await decrypt(cookie || '');

    // 4. Redirect to /login if the user is not authenticated
    if (!isPublicRoute && !session?.userId) {
        return NextResponse.redirect(new URL('/login', req.nextUrl));
    }

    // 5. Redirect to / if the user is authenticated (and tries to go to login)
    if (isPublicRoute && session?.userId && path === '/login') {
        return NextResponse.redirect(new URL('/', req.nextUrl));
    }

    return NextResponse.next();
}

// Routes Middleware should not run on
export const config = {
    matcher: ['/((?!_next/static|_next/image|.*\\.png$).*)'],
};
