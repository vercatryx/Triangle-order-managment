import { cookies } from 'next/headers';

/**
 * Returns the current time in EST/EDT timezone.
 * On component/server actions (where cookies() is available), it checks for the 'x-fake-time' cookie.
 * If no cookie is present, it returns the current real time converted to EST/EDT timezone.
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

    // Get current UTC time
    const utcNow = new Date();
    
    // Get the time components in EST/EDT timezone
    const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    const parts = estFormatter.formatToParts(utcNow);
    const year = parseInt(parts.find(p => p.type === 'year')!.value);
    const month = parseInt(parts.find(p => p.type === 'month')!.value) - 1; // 0-indexed
    const day = parseInt(parts.find(p => p.type === 'day')!.value);
    const hour = parseInt(parts.find(p => p.type === 'hour')!.value);
    const minute = parseInt(parts.find(p => p.type === 'minute')!.value);
    const second = parseInt(parts.find(p => p.type === 'second')!.value);
    
    // Create a UTC date object with the EST time components
    // Then adjust by the EST/EDT offset to get the correct UTC time
    // Example: EST 12:00 PM = UTC 5:00 PM (EST is 5 hours behind UTC)
    const estAsUTC = new Date(Date.UTC(year, month, day, hour, minute, second));
    
    // Get the EST/EDT offset for this date (handles DST automatically)
    const offsetMinutes = getESTOffset(utcNow);
    
    // Convert EST time to UTC: subtract the offset (which is negative, so this adds time)
    // EST offset is -300 minutes (5 hours behind), so subtracting -300 = adding 300 minutes
    // This gives us the UTC time that corresponds to the EST time
    const correctUTC = new Date(estAsUTC.getTime() - offsetMinutes * 60 * 1000);
    
    return correctUTC;
}

/**
 * Get the EST/EDT offset in minutes from UTC for a given date
 * EST = UTC-5 (300 minutes behind), EDT = UTC-4 (240 minutes behind)
 */
function getESTOffset(date: Date): number {
    // Create a formatter to get the timezone name
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        timeZoneName: 'short'
    });
    
    const parts = formatter.formatToParts(date);
    const tzName = parts.find(p => p.type === 'timeZoneName')?.value || '';
    
    // EST is UTC-5 (300 minutes), EDT is UTC-4 (240 minutes)
    // Return negative because EST is behind UTC
    return tzName.includes('EDT') ? -240 : -300;
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
