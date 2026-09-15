/**
 * The member's seat in each pot: a 32-byte secret and a slot number.
 *
 * This is the only thing that ties a person to a seat. It is stored in this
 * browser's localStorage under the pot and the wallet that took the seat, so two
 * wallets in one browser never share a seat (sharing a secret would also make
 * their payments collide on the same nullifier). Nothing here is sent anywhere;
 * the chain sees only hashes of the secret. Losing it means losing the ability to pay in or take the pot, so the app
 * offers a backup and restore.
 */
export type Membership = {
  secretKeyHex: string;
  slot: string;
  /** False between submitting join() and seeing it confirmed. */
  confirmed: boolean;
  /** Set when the join transaction failed, so the member can try again. */
  failed?: boolean;
  /** When the seat was saved (ms since epoch), to let a stuck pending seat be retried. */
  savedAt?: number;
};

const STORAGE_KEY = 'nightpot:seats:v2';
/** Seats saved before they were linked to wallets, keyed by pot only. */
const LEGACY_KEY = 'nightpot:memberships';

const readAll = (key: string = STORAGE_KEY): Record<string, Membership> => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, Membership>) : {};
  } catch {
    return {};
  }
};

const writeAll = (all: Record<string, Membership>, key: string = STORAGE_KEY): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(all));
  } catch {
    // Storage can be unavailable (private windows); the seat still works for this session.
  }
};

const normalize = (address: string): string => address.trim().toLowerCase();

const seatKey = (pot: string, wallet: string): string => `${normalize(pot)}|${wallet.trim()}`;

/** The seat this wallet holds in this pot on this device, if any. */
export const loadMembership = (pot: string, wallet: string | null): Membership | null =>
  wallet ? (readAll()[seatKey(pot, wallet)] ?? null) : null;

export const saveMembership = (pot: string, wallet: string, membership: Membership): void => {
  writeAll({ ...readAll(), [seatKey(pot, wallet)]: membership });
};

export const forgetMembership = (pot: string, wallet: string): void => {
  const all = readAll();
  delete all[seatKey(pot, wallet)];
  writeAll(all);
};

/** A seat saved for this pot before seats were linked to wallets. */
export const loadLegacyMembership = (pot: string): Membership | null => readAll(LEGACY_KEY)[normalize(pot)] ?? null;

export const clearLegacyMembership = (pot: string): void => {
  const all = readAll(LEGACY_KEY);
  delete all[normalize(pot)];
  writeAll(all, LEGACY_KEY);
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
