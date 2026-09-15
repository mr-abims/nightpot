import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Phase { forming = 0, active = 1, completed = 2, cancelled = 3 }

export type Witnesses<PS> = {
  memberSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  memberSlot(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  memberPayout(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, { bytes: Uint8Array
                                                                           }];
  memberPath(context: __compactRuntime.WitnessContext<Ledger, PS>,
             leaf_0: Uint8Array): [PS, { leaf: Uint8Array,
                                         path: { sibling: { field: bigint },
                                                 goes_left: boolean
                                               }[]
                                       }];
}

export type ImpureCircuits<PS> = {
  join(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancel(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  contribute(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  claimPayout(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  skipRound(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  join(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancel(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  contribute(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  claimPayout(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  skipRound(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  memberLeaf(sk_0: Uint8Array,
             slot_0: bigint,
             payout_0: Uint8Array,
             potId_0: Uint8Array): Uint8Array;
  joinTag(sk_0: Uint8Array, potId_0: Uint8Array): Uint8Array;
  contributionNullifier(sk_0: Uint8Array,
                        slot_0: bigint,
                        r_0: bigint,
                        potId_0: Uint8Array): Uint8Array;
  payoutNullifier(sk_0: Uint8Array, r_0: bigint, potId_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  join(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancel(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  contribute(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  claimPayout(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  skipRound(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  memberLeaf(context: __compactRuntime.CircuitContext<PS>,
             sk_0: Uint8Array,
             slot_0: bigint,
             payout_0: Uint8Array,
             potId_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  joinTag(context: __compactRuntime.CircuitContext<PS>,
          sk_0: Uint8Array,
          potId_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  contributionNullifier(context: __compactRuntime.CircuitContext<PS>,
                        sk_0: Uint8Array,
                        slot_0: bigint,
                        r_0: bigint,
                        potId_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  payoutNullifier(context: __compactRuntime.CircuitContext<PS>,
                  sk_0: Uint8Array,
                  r_0: bigint,
                  potId_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
}

export type Ledger = {
  readonly phase: Phase;
  readonly maxMembers: bigint;
  readonly contribution: bigint;
  readonly joinDeadline: bigint;
  readonly roundLength: bigint;
  readonly details: Uint8Array;
  members: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  readonly memberCount: bigint;
  readonly round: bigint;
  readonly paidThisRound: bigint;
  joined: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  contributions: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  payouts: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly missedPayments: bigint;
  readonly skippedRounds: bigint;
  readonly potBalance: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               size_0: bigint,
               amount_0: bigint,
               joinBy_0: bigint,
               roundSeconds_0: bigint,
               detailsCommitment_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
