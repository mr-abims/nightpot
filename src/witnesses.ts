/**
 * Private state and witness implementations for NightPot.
 *
 * Everything in this file stays on the member's device. The chain only ever
 * sees hashes derived from it: a hidden Merkle leaf when the member joins, and
 * one-way tags when they join, contribute, or claim. The payout address is
 * bound into the leaf at join and revealed only when that seat's payout is
 * sent. See contracts/nightpot.compact.
 *
 * Types come from @midnight-ntwrk/compact-runtime (not the generated contract),
 * so the web app can type-check this file without a local compile. The tests
 * assert that `witnesses` satisfies the generated `Witnesses<NightPotPrivateState>`.
 */
import type { MerkleTreePath, WitnessContext } from '@midnight-ntwrk/compact-runtime';

/** A member's private state for one pot. Never leaves this device. */
export type NightPotPrivateState = {
  /** 32-byte member secret. Losing it means losing access to the seat. */
  readonly secretKey: Uint8Array;
  /** 32-byte unshielded wallet address that this seat's payouts go to. */
  readonly payoutAddress: Uint8Array;
  /** The seat taken at join (0-based); undefined until the seat is known. */
  readonly slot?: bigint;
};

export const SECRET_KEY_BYTES = 32;

export const createNightPotPrivateState = (
  secretKey: Uint8Array,
  payoutAddress: Uint8Array,
  slot?: bigint,
): NightPotPrivateState => ({ secretKey, payoutAddress, slot });

/** Generate a fresh random member secret using the platform CSPRNG. */
export const randomSecretKey = (): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(SECRET_KEY_BYTES));

/** The part of the public ledger the witnesses read. */
type MembersLedger = {
  members: { findPathForLeaf(leaf: Uint8Array): MerkleTreePath<Uint8Array> | undefined };
};

type Context = WitnessContext<MembersLedger, NightPotPrivateState>;

export const NOT_A_MEMBER = 'NightPot: not a member of this pot';

/**
 * Witness implementations, matching `Witnesses<PS>` in the generated contract.
 * Each returns `[nextPrivateState, value]`; none of them mutate private state.
 */
export const witnesses = {
  memberSecret: ({ privateState }: Context): [NightPotPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],

  memberSlot: ({ privateState }: Context): [NightPotPrivateState, bigint] => {
    if (privateState.slot === undefined) {
      throw new Error('NightPot: no seat is recorded for this pot on this device');
    }
    return [privateState, privateState.slot];
  },

  memberPayout: ({ privateState }: Context): [NightPotPrivateState, { bytes: Uint8Array }] => [
    privateState,
    { bytes: privateState.payoutAddress },
  ],

  // The Merkle path is computed locally from the public tree; only the root it
  // leads to is checked on-chain, so the ledger never learns which leaf is ours.
  memberPath: ({ privateState, ledger }: Context, leaf: Uint8Array): [NightPotPrivateState, MerkleTreePath<Uint8Array>] => {
    const path = ledger.members.findPathForLeaf(leaf);
    if (path === undefined) {
      throw new Error(NOT_A_MEMBER);
    }
    return [privateState, path];
  },
};
