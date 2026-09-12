/**
 * A local testbed for the NightPot contract.
 *
 * It runs the real compiled circuits against an in-memory ledger — the same
 * code path the chain executes — without a node, a wallet, or a proof server.
 * Several members share one ledger; each call runs with that member's private
 * state swapped in, exactly as each member's own device would.
 */
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

import {
  type CircuitContext,
  CostModel,
  QueryContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract,
  type Ledger,
  ledger,
  pureCircuits,
} from '../managed/nightpot/contract/index.js';
import {
  createNightPotPrivateState,
  witnesses,
  type NightPotPrivateState,
} from '../src/witnesses.js';

/** Zswap coin public key stand-in for the simulated caller. */
const TEST_COIN_PUBLIC_KEY = '0'.repeat(64);

export type ShieldedCoin = { nonce: Uint8Array; color: Uint8Array; value: bigint };

/** A pot member as their own device sees them. */
export type Member = {
  readonly name: string;
  readonly secretKey: Uint8Array;
  slot: bigint;
};

export const member = (name: string, byteHex: string): Member => ({
  name,
  secretKey: Uint8Array.from(Buffer.from(byteHex.repeat(32), 'hex')),
  slot: 0n,
});

export class NightPotSimulator {
  readonly contract: Contract<NightPotPrivateState>;
  readonly address: string;
  circuitContext: CircuitContext<NightPotPrivateState>;

  constructor(size: bigint, contribution: bigint, deployer: Uint8Array = new Uint8Array(32)) {
    this.contract = new Contract<NightPotPrivateState>(witnesses as any);
    this.address = sampleContractAddress();

    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(createNightPotPrivateState(deployer), TEST_COIN_PUBLIC_KEY),
        size,
        contribution,
        new Uint8Array(32).fill(7),
      );

    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, this.address),
    };
  }

  /** The public, on-chain view of the pot. */
  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  /** The pot's identifier as used inside nullifiers. */
  public get potId(): Uint8Array {
    return Uint8Array.from(Buffer.from(this.address, 'hex'));
  }

  /** Run the next call as `m`, with m's private state on "their device". */
  private as(m: Member): void {
    this.circuitContext.currentPrivateState = createNightPotPrivateState(m.secretKey, m.slot);
  }

  public join(m: Member): Ledger {
    // The member learns their slot from public state before proving; if another
    // join lands first, the proof no longer matches the ledger and is rejected.
    m.slot = this.getLedger().memberCount;
    this.as(m);
    this.circuitContext = this.contract.impureCircuits.join(this.circuitContext).context;
    return this.getLedger();
  }

  /** A coin of exactly this pot's token and contribution amount. */
  public validCoin(): ShieldedCoin {
    const state = this.getLedger();
    return { nonce: Uint8Array.from(randomBytes(32)), color: state.potColor, value: state.contribution };
  }

  public contribute(m: Member, coin: ShieldedCoin = this.validCoin()): Ledger {
    this.as(m);
    this.circuitContext = this.contract.impureCircuits.contribute(this.circuitContext, coin).context;
    return this.getLedger();
  }

  public claimPayout(m: Member): ShieldedCoin {
    this.as(m);
    const { context, result } = this.contract.impureCircuits.claimPayout(this.circuitContext);
    this.circuitContext = context;
    return result;
  }

  public mintTestTokens(m: Member): ShieldedCoin {
    this.as(m);
    const { context, result } = this.contract.impureCircuits.mintTestTokens(this.circuitContext);
    this.circuitContext = context;
    return result;
  }

  /** Every member of `members` pays this round. */
  public fundRound(members: Member[]): Ledger {
    for (const m of members) this.contribute(m);
    return this.getLedger();
  }

  public static leaf(m: Member, slot: bigint = m.slot): Uint8Array {
    return pureCircuits.memberLeaf(m.secretKey, slot);
  }

  public contributionNullifier(m: Member, round: bigint): Uint8Array {
    return pureCircuits.contributionNullifier(m.secretKey, round, this.potId);
  }

  public payoutNullifier(m: Member, round: bigint): Uint8Array {
    return pureCircuits.payoutNullifier(m.secretKey, round, this.potId);
  }
}
