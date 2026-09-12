/**
 * Private state and witness implementations for NightPot.
 *
 * Everything in this file stays on the member's device. The chain only ever
 * sees hashes derived from it: a hidden Merkle leaf when the member joins, and
 * one-way nullifiers when they contribute or claim — see
 * contracts/nightpot.compact.
 */
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/** A member's private state for one pot. Never leaves this device. */
export type NightPotPrivateState = {
  /** 32-byte member secret. Losing it means losing access to the slot. */
  readonly secretKey: Uint8Array;
  /** The member's turn in the rotation (0-based), fixed when they join. */
  readonly slot: bigint;
};

export const SECRET_KEY_BYTES = 32;

export const createNightPotPrivateState = (
  secretKey: Uint8Array,
  slot: bigint = 0n,
): NightPotPrivateState => ({ secretKey, slot });

/** Generate a fresh random member secret using the platform CSPRNG. */
export const randomSecretKey = (): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(SECRET_KEY_BYTES));

/**
 * Witness implementations, matching `Witnesses<PS>` in the generated contract.
 * Each returns `[nextPrivateState, value]`; none of them mutate private state.
 */
export const witnesses = {
  memberSecret: ({
    privateState,
  }: WitnessContext<any, NightPotPrivateState>): [NightPotPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],

  memberSlot: ({
    privateState,
  }: WitnessContext<any, NightPotPrivateState>): [NightPotPrivateState, bigint] => [
    privateState,
    privateState.slot,
  ],

  // The Merkle path is computed locally from the public tree; only the root it
  // leads to is checked on-chain, so the ledger never learns which leaf is ours.
  memberPath: (
    { privateState, ledger }: WitnessContext<any, NightPotPrivateState>,
    leaf: Uint8Array,
  ): [NightPotPrivateState, any] => {
    const path = ledger.members.findPathForLeaf(leaf);
    if (path === undefined) {
      throw new Error('NightPot: this member is not in the pot');
    }
    return [privateState, path];
  },
};
