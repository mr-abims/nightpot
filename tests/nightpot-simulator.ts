/**
 * A local testbed for the NightPot contract.
 *
 * It runs the real compiled circuits against an in-memory ledger — the same
 * code path the chain executes — without a node, a wallet, or a proof server.
 * Several members share one ledger; each call runs with that member's private
 * state swapped in, exactly as each member's own device would. The block clock
 * is controllable so round deadlines can be tested, and witnesses can be
 * replaced to exercise the contract's own checks against a dishonest prover.
 */
import { Buffer } from 'node:buffer';

import {
  type CircuitContext,
  CostModel,
  QueryContext,
  createConstructorContext,
  encodeUserAddress,
  sampleContractAddress,
  sampleUserAddress,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract,
  type Ledger,
  type Witnesses,
  ledger,
  pureCircuits,
} from '../managed/nightpot/contract/index.js';
import {
  createNightPotPrivateState,
  witnesses,
  type NightPotPrivateState,
} from '../src/witnesses.js';

// Compile-time check: the witnesses satisfy the contract's generated witness type.
const honestWitnesses: Witnesses<NightPotPrivateState> = witnesses;

/** Zswap coin public key stand-in for the simulated caller. */
const TEST_COIN_PUBLIC_KEY = '0'.repeat(64);

/** A fixed "now" so tests are deterministic. */
export const T0 = 1_800_000_000n;
export const JOIN_WINDOW = 3_600n;
export const ROUND_SECONDS = 86_400n;

/** A member as their own device sees them: a secret, a wallet, and (once joined) a seat. */
export type Member = {
  readonly name: string;
  readonly secretKey: Uint8Array;
  /** The wallet's address as the ledger prints it (hex). */
  readonly walletHex: string;
  /** The same address as the contract's UserAddress bytes. */
  readonly wallet: Uint8Array;
  slot?: bigint;
};

export const member = (name: string, byteHex: string, walletHex: string = sampleUserAddress()): Member => ({
  name,
  secretKey: Uint8Array.from(Buffer.from(byteHex.repeat(32), 'hex')),
  walletHex,
  wallet: encodeUserAddress(walletHex),
});

export type PotOptions = {
  details?: Uint8Array;
  joinBy?: bigint;
  roundSeconds?: bigint;
  now?: bigint;
};

export class NightPotSimulator {
  readonly contract: Contract<NightPotPrivateState>;
  readonly address: string;
  circuitContext: CircuitContext<NightPotPrivateState>;

  constructor(size: bigint, contribution: bigint, options: PotOptions = {}) {
    this.contract = new Contract<NightPotPrivateState>(honestWitnesses);
    this.address = sampleContractAddress();

    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(
          createNightPotPrivateState(new Uint8Array(32), new Uint8Array(32)),
          TEST_COIN_PUBLIC_KEY,
        ),
        size,
        contribution,
        options.joinBy ?? T0 + JOIN_WINDOW,
        options.roundSeconds ?? ROUND_SECONDS,
        options.details ?? new Uint8Array(32).fill(5),
      );

    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, this.address),
    };
    this.setTime(options.now ?? T0);
  }

  /** Move the simulated block clock. */
  public setTime(secondsSinceEpoch: bigint): void {
    const query = this.circuitContext.currentQueryContext;
    query.block = { ...query.block, secondsSinceEpoch, secondsSinceEpochErr: 0, lastBlockTime: secondsSinceEpoch };
  }

  /** The public, on-chain view of the pot. */
  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  /** When round `r` falls due, computed exactly as the contract does. */
  public roundDue(r: bigint): bigint {
    const l = this.getLedger();
    return l.joinDeadline + (r + 1n) * l.roundLength;
  }

  /** The pot's identifier as used inside leaves and tags. */
  public get potId(): Uint8Array {
    return Uint8Array.from(Buffer.from(this.address, 'hex'));
  }

  /** Run the next call as `m`, with m's private state on "their device". */
  private as(m: Member): void {
    this.circuitContext.currentPrivateState = createNightPotPrivateState(m.secretKey, m.wallet, m.slot);
  }

  public join(m: Member): Ledger {
    // The member learns their slot from public state before proving; if another
    // join lands first, the proof no longer matches the ledger and is rejected.
    m.slot = this.getLedger().memberCount;
    this.as(m);
    this.circuitContext = this.contract.impureCircuits.join(this.circuitContext).context;
    return this.getLedger();
  }

  public cancel(): Ledger {
    this.circuitContext = this.contract.impureCircuits.cancel(this.circuitContext).context;
    return this.getLedger();
  }

  public skipRound(): Ledger {
    this.circuitContext = this.contract.impureCircuits.skipRound(this.circuitContext).context;
    return this.getLedger();
  }

  public contribute(m: Member, using: Witnesses<NightPotPrivateState> = honestWitnesses): Ledger {
    this.as(m);
    const contract = using === honestWitnesses ? this.contract : new Contract<NightPotPrivateState>(using);
    this.circuitContext = contract.impureCircuits.contribute(this.circuitContext).context;
    return this.getLedger();
  }

  /** Claims as `m` and returns the NIGHT the contract authorised to each wallet in this call. */
  public claimPayout(m: Member, using: Witnesses<NightPotPrivateState> = honestWitnesses): Map<string, bigint> {
    const before = this.unshieldedSpends();
    this.as(m);
    const contract = using === honestWitnesses ? this.contract : new Contract<NightPotPrivateState>(using);
    this.circuitContext = contract.impureCircuits.claimPayout(this.circuitContext).context;
    const after = this.unshieldedSpends();
    const paid = new Map<string, bigint>();
    for (const [wallet, amount] of after) {
      const delta = amount - (before.get(wallet) ?? 0n);
      if (delta > 0n) paid.set(wallet, delta);
    }
    return paid;
  }

  /** Unshielded NIGHT the contract has authorised to user wallets so far, by wallet hex. */
  public unshieldedSpends(): Map<string, bigint> {
    const totals = new Map<string, bigint>();
    for (const [[, recipient], amount] of this.circuitContext.currentQueryContext.effects.claimedUnshieldedSpends) {
      if (recipient.tag === 'user') {
        totals.set(recipient.address, (totals.get(recipient.address) ?? 0n) + amount);
      }
    }
    return totals;
  }

  /** Every member of `members` pays this round. */
  public fundRound(members: Member[]): Ledger {
    for (const m of members) this.contribute(m);
    return this.getLedger();
  }

  public leaf(m: Member, slot: bigint = m.slot ?? 0n, wallet: Uint8Array = m.wallet): Uint8Array {
    return pureCircuits.memberLeaf(m.secretKey, slot, wallet, this.potId);
  }

  public joinTag(m: Member): Uint8Array {
    return pureCircuits.joinTag(m.secretKey, this.potId);
  }

  public contributionNullifier(m: Member, round: bigint, slot: bigint = m.slot ?? 0n): Uint8Array {
    return pureCircuits.contributionNullifier(m.secretKey, slot, round, this.potId);
  }

  public payoutNullifier(m: Member, round: bigint): Uint8Array {
    return pureCircuits.payoutNullifier(m.secretKey, round, this.potId);
  }
}

export { honestWitnesses };
