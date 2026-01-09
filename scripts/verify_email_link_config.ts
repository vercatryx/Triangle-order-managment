
// This script simulates the base URL resolution logic in lib/form-actions.ts
// to verify that APP_URL and SITE_URL are correctly prioritized.

function resolveBaseUrl(env: any) {
    // Priority: APP_URL -> SITE_URL -> NEXT_PUBLIC_APP_URL -> NEXT_PUBLIC_VERCEL_URL
    let baseUrl = env.APP_URL || env.SITE_URL || env.NEXT_PUBLIC_APP_URL;

    if (!baseUrl && env.NEXT_PUBLIC_VERCEL_URL) {
        baseUrl = `https://${env.NEXT_PUBLIC_VERCEL_URL}`;
    }

    if (!baseUrl) {
        baseUrl = 'http://localhost:3000';
    }

    return baseUrl;
}

const testCases = [
    {
        name: "Priority: APP_URL",
        env: {
            APP_URL: "https://www.trianglesquareservices.com",
            SITE_URL: "https://site-url.com",
            NEXT_PUBLIC_APP_URL: "https://next-public-app-url.com",
            NEXT_PUBLIC_VERCEL_URL: "vercel-deployment.vercel.app"
        },
        expected: "https://www.trianglesquareservices.com"
    },
    {
        name: "Priority: SITE_URL",
        env: {
            SITE_URL: "https://www.trianglesquareservices.com",
            NEXT_PUBLIC_APP_URL: "https://next-public-app-url.com",
            NEXT_PUBLIC_VERCEL_URL: "vercel-deployment.vercel.app"
        },
        expected: "https://www.trianglesquareservices.com"
    },
    {
        name: "Fallback: NEXT_PUBLIC_APP_URL",
        env: {
            NEXT_PUBLIC_APP_URL: "https://www.trianglesquareservices.com",
            NEXT_PUBLIC_VERCEL_URL: "vercel-deployment.vercel.app"
        },
        expected: "https://www.trianglesquareservices.com"
    },
    {
        name: "Fallback: NEXT_PUBLIC_VERCEL_URL",
        env: {
            NEXT_PUBLIC_VERCEL_URL: "vercel-deployment.vercel.app"
        },
        expected: "https://vercel-deployment.vercel.app"
    },
    {
        name: "Default: localhost",
        env: {},
        expected: "http://localhost:3000"
    }
];

let allPassed = true;
testCases.forEach(tc => {
    const result = resolveBaseUrl(tc.env);
    if (result === tc.expected) {
        console.log(`✅ PASS: ${tc.name}`);
    } else {
        console.error(`❌ FAIL: ${tc.name}`);
        console.error(`   Expected: ${tc.expected}`);
        console.error(`   Got:      ${result}`);
        allPassed = false;
    }
});

if (!allPassed) {
    process.exit(1);
} else {
    console.log("\nAll verification tests passed!");
}
