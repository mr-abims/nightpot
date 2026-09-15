/**
 * A pot's name and goal: private, but verifiable.
 *
 * Only a salted SHA-256 commitment goes on-chain (the contract's `details`
 * field). The text and salt travel in the invite link's fragment, after `#`,
 * which browsers never send to a server. Each member's app recomputes the
 * commitment and compares it with the chain, so a forged name is detected while
 * outsiders see only 32 random-looking bytes.
 */
export type PotDetails = {
  name: string;
  goal: string;
  /** 32 random bytes, hex. Without it the name could be guessed from the hash. */
  saltHex: string;
};

export const NAME_MAX = 48;
export const GOAL_MAX = 120;

const DOMAIN = 'nightpot:details:v1';
const STORAGE_KEY = 'nightpot:details';

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const normalizePot = (pot: string): string => pot.trim().toLowerCase();

export const newDetails = (name: string, goal: string): PotDetails => ({
  name: name.trim().slice(0, NAME_MAX),
  goal: goal.trim().slice(0, GOAL_MAX),
  saltHex: toHex(globalThis.crypto.getRandomValues(new Uint8Array(32))),
});

/** The commitment stored on-chain. Domain-separated and JSON-encoded so fields cannot be shifted. */
export async function commitDetails(details: PotDetails): Promise<Uint8Array> {
  const payload = JSON.stringify([DOMAIN, details.name, details.goal, details.saltHex]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return new Uint8Array(digest);
}

const base64UrlEncode = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlDecode = (value: string): string => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

/** The part of an invite link after `#`. */
export const encodeDetailsFragment = (details: PotDetails): string =>
  `details=${base64UrlEncode(JSON.stringify({ n: details.name, g: details.goal, s: details.saltHex }))}`;

/** Reads pot details from `window.location.hash`; returns null for anything malformed. */
export function decodeDetailsFragment(hash: string): PotDetails | null {
  try {
    const raw = new URLSearchParams(hash.replace(/^#/, '')).get('details');
    if (!raw) return null;
    const parsed = JSON.parse(base64UrlDecode(raw)) as { n?: unknown; g?: unknown; s?: unknown };
    if (typeof parsed.n !== 'string' || typeof parsed.g !== 'string' || typeof parsed.s !== 'string') return null;
    if (!parsed.n.trim() || parsed.n.length > NAME_MAX || parsed.g.length > GOAL_MAX) return null;
    if (!/^[0-9a-f]{64}$/.test(parsed.s)) return null;
    return { name: parsed.n, goal: parsed.g, saltHex: parsed.s };
  } catch {
    return null;
  }
}

const readAll = (): Record<string, PotDetails> => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PotDetails>) : {};
  } catch {
    return {};
  }
};

/** Details this device has seen for a pot (from creating it or opening its invite link). */
export const loadDetails = (pot: string): PotDetails | null => readAll()[normalizePot(pot)] ?? null;

export const saveDetails = (pot: string, details: PotDetails): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [normalizePot(pot)]: details }));
  } catch {
    // Storage unavailable: the name shows for this visit only via the invite link.
  }
};
