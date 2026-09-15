/**
 * NIGHT amounts and wallet addresses for NightPot.
 *
 * Wave 1 pots move unshielded NIGHT (tNIGHT on Preprod). Amounts on-chain are in
 * the smallest unit; 1 NIGHT = 1,000,000 of them. Payouts go to a wallet's
 * unshielded address, which the contract takes as 32 raw bytes.
 */
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';

export const UNITS_PER_NIGHT = 1_000_000n;
const DECIMALS = 6;

/** The key wallets use for the NIGHT balance in getUnshieldedBalances(). */
export const NIGHT_BALANCE_KEY = unshieldedToken().raw;

/** 1500000n -> "1.5" */
export function formatNight(units: bigint): string {
  const whole = units / UNITS_PER_NIGHT;
  const fraction = units % UNITS_PER_NIGHT;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(DECIMALS, '0').replace(/0+$/, '')}`;
}

/** "1.5" -> 1500000n; null for anything that is not a non-negative amount with at most 6 decimals. */
export function parseNight(text: string): bigint | null {
  const match = text.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * UNITS_PER_NIGHT + BigInt((match[2] ?? '').padEnd(DECIMALS, '0') || '0');
}

/** A wallet's unshielded "mn_addr..." address as the 32 bytes the contract's UserAddress expects. */
export function userAddressBytes(bech32Address: string, networkId: string): Uint8Array {
  const parsed = MidnightBech32m.parse(bech32Address);
  const address = parsed.decode(UnshieldedAddress, networkId as never) as UnshieldedAddress;
  return Uint8Array.from(address.data);
}
