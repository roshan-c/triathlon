/**
 * Time and identifier dependencies.
 *
 * These are the variable dependencies that receive test adapters: a fixed
 * clock for metric tests, and the real system clock and CSPRNG in production.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date): Clock {
  return { now: () => new Date(at) };
}

/**
 * Day-boundary helpers in an IANA time zone. SQLite stores timestamps as UTC
 * ISO strings; daily metrics (burndown, completed-per-day) are keyed by the
 * project-local calendar day.
 */

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(tz: string): Intl.DateTimeFormat {
  let f = zonedFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    zonedFormatterCache.set(tz, f);
  }
  return f;
}

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = zonedFormatter(tz).formatToParts(date);
  const get = (type: string): number => {
    const p = parts.find((part) => part.type === type);
    return p ? Number.parseInt(p.value, 10) : 0;
  };
  let hour = get("hour");
  if (hour === 24) hour = 0; // some locales emit 24:xx for midnight
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * The UTC instant whose local clock reads midnight on the given local
 * calendar day. Converges by applying the offset observed at the guess;
 * Date.UTC arithmetic handles month and year overflow (day 0, day 32).
 */
function localMidnightForDay(year: number, month: number, day: number, tz: string): Date {
  let target = new Date(Date.UTC(year, month - 1, day));
  for (let i = 0; i < 4; i++) {
    const q = zonedParts(target, tz);
    if (q.hour === 0 && q.minute === 0 && q.second === 0) {
      if (q.year === year && q.month === month && q.day === day) return target;
    }
    // Offset of this instant: how far the local wall clock is from UTC,
    // computed by treating the local parts as if they were UTC.
    const offsetMinutes =
      (Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) -
        target.getTime()) /
      60_000;
    target = new Date(target.getTime() - offsetMinutes * 60_000);
  }
  return target;
}

/** Start of the local calendar day containing `date`, returned as UTC. */
export function dayStartInTz(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return localMidnightForDay(p.year, p.month, p.day, tz);
}

/** UTC instant of local midnight AFTER the local day containing `date`. */
export function nextLocalDayBoundary(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return localMidnightForDay(p.year, p.month, p.day + 1, tz);
}

/** Local calendar day key, e.g. "2026-09-07". */
export function dayKeyInTz(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year.toString().padStart(4, "0")}-${p.month
    .toString()
    .padStart(2, "0")}-${p.day.toString().padStart(2, "0")}`;
}

/** Add whole days to a date. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}