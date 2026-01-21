import { cookies } from 'next/headers';

/**
 * Returns the current time.
 * On component/server actions (where cookies() is available), it checks for the 'x-fake-time' cookie.
 * On client (if this were used directly, though strictly this uses next/headers so it's server-only),
 * it would fail.
 * 
 * For Client Components, use the TimeContext.
 */
export async function getCurrentTime(): Promise<Date> {
    try {
        const cookieStore = await cookies();
        const fakeTimeCookie = cookieStore.get('x-fake-time');

        if (fakeTimeCookie && fakeTimeCookie.value) {
            const fakeDate = new Date(fakeTimeCookie.value);
            if (!isNaN(fakeDate.getTime())) {
                return fakeDate;
            }
        }
    } catch (error) {
        // cookies() might fail if called outside of request context (e.g. static gen), fallback to real time
    }

    return new Date();
}

export function getTodaysDateInTimezone(timezone: string): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  };
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;

  return `${year}-${month}-${day}`;
}
