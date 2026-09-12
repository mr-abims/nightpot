/**
 * The member's seat in each pot: a 32-byte secret and a slot number.
 *
 * This is the only thing that ties a person to a seat. It is stored in this
 * browser's localStorage and never sent anywhere; the chain sees only hashes of
 * it. Losing it means losing the ability to pay in or take the pot, so the app
 * offers a backup and restore.
 */
export type Membership = {
  secretKeyHex: string;
  slot: string;
  /** False between submitting join() and seeing it confirmed. */
  confirmed: boolean;
};

const STORAGE_KEY = 'nightpot:memberships';

const readAll = (): Record<string, Membership> => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Membership>) : {};
  } catch {
    return {};
  }
};

const writeAll = (all: Record<string, Membership>): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage can be unavailable (private windows); the seat still works for this session.
  }
};

const normalize = (address: string): string => address.trim().toLowerCase();

export const loadMembership = (address: string): Membership | null => readAll()[normalize(address)] ?? null;

export const saveMembership = (address: string, membership: Membership): void => {
  writeAll({ ...readAll(), [normalize(address)]: membership });
};

export const forgetMembership = (address: string): void => {
  const all = readAll();
  delete all[normalize(address)];
  writeAll(all);
};

export const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/, '');
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(clean)) throw new Error('Not a hex string.');
  return Uint8Array.from(clean.match(/../g)!.map((b) => parseInt(b, 16)));
};

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const randomBytes32 = (): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(32));

/** A seat backup the member can copy somewhere safe and paste back later. */
export const encodeBackup = (address: string, m: Membership): string =>
  JSON.stringify({ app: 'nightpot', pot: normalize(address), secret: m.secretKeyHex, slot: m.slot });

export const decodeBackup = (text: string): { pot: string; membership: Membership } => {
  const parsed = JSON.parse(text) as { app?: string; pot?: string; secret?: string; slot?: string };
  if (parsed.app !== 'nightpot' || !parsed.pot || !parsed.secret || parsed.slot === undefined) {
    throw new Error('That is not a NightPot seat backup.');
  }
  if (hexToBytes(parsed.secret).length !== 32) throw new Error('The backup secret must be 32 bytes.');
  return { pot: normalize(parsed.pot), membership: { secretKeyHex: parsed.secret, slot: String(parsed.slot), confirmed: true } };
};
