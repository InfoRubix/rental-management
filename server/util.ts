import { createHash, randomInt } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function newId(length = 20): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return out;
}

// No 0/O, 1/I/L to keep references easy to read over the phone.
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
/** Human-readable reference such as RM-7KQ2-XH4P. Identifies a request but never authorises access. */
export function newReference(): string {
  const part = () => Array.from({ length: 4 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('');
  return `RM-${part()}-${part()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Today's date as YYYY-MM-DD in the configured business time zone. */
export function todayIn(timezone: string, date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}
