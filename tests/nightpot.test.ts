/**
 * Tests for the NightPot contract.
 *
 * Three things are worth proving about a private savings pot:
 *   1. the rotation works end to end and every rule is enforced (logic),
 *   2. the public ledger evolves correctly round by round (state),
 *   3. member secrets and slots never reach public state (privacy).
 */
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';

import { Phase } from '../managed/nightpot/contract/index.js';
import { NightPotSimulator, member, type Member } from './nightpot-simulator.js';

const CONTRIBUTION = 100n;
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

let alice: Member;
let bob: Member;
let carol: Member;
let mallory: Member;

beforeEach(() => {
  alice = member('alice', 'a1');
  bob = member('bob', 'b2');
  carol = member('carol', 'c3');
  mallory = member('mallory', 'dd');
});

/** A 3-member pot with everyone joined, so round 0 is open. */
const activePot = (): NightPotSimulator => {
  const pot = new NightPotSimulator(3n, CONTRIBUTION);
  pot.join(alice);
  pot.join(bob);
  pot.join(carol);
  return pot;
};

describe('constructor', () => {
  it('opens a forming pot with the chosen size and contribution', () => {
    const state = new NightPotSimulator(3n, CONTRIBUTION).getLedger();

    expect(state.phase).toEqual(Phase.forming);
    expect(state.maxMembers).toEqual(3n);
    expect(state.contribution).toEqual(CONTRIBUTION);
    expect(state.memberCount).toEqual(0n);
    expect(state.round).toEqual(0n);
    expect(state.paidThisRound).toEqual(0n);
    expect(state.potHasCoin).toBe(false);
    expect(state.potColor).toHaveLength(32);
  });

  it('rejects a pot with fewer than two members', () => {
    expect(() => new NightPotSimulator(1n, CONTRIBUTION)).toThrow('NightPot: a pot needs at least two members');
  });

  it('rejects a pot with more than 64 members', () => {
    expect(() => new NightPotSimulator(65n, CONTRIBUTION)).toThrow('NightPot: a pot can have at most 64 members');
  });

  it('rejects a zero contribution', () => {
    expect(() => new NightPotSimulator(3n, 0n)).toThrow('NightPot: contribution must be positive');
  });
});

describe('join', () => {
  it('assigns slots in join order and counts members', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);

    expect(pot.join(alice).memberCount).toEqual(1n);
    expect(pot.join(bob).memberCount).toEqual(2n);

    expect(alice.slot).toEqual(0n);
    expect(bob.slot).toEqual(1n);
    expect(pot.getLedger().phase).toEqual(Phase.forming);
  });

  it('activates the pot when the last seat is taken', () => {
    const state = activePot().getLedger();

    expect(state.memberCount).toEqual(3n);
    expect(state.phase).toEqual(Phase.active);
    expect(state.round).toEqual(0n);
  });

  it('fixes the pot token when the pot activates', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);
    pot.join(alice);
    expect(hex(pot.getLedger().potColor)).toEqual('00'.repeat(32));

    pot.join(bob);
    pot.join(carol);
    expect(hex(pot.getLedger().potColor)).not.toEqual('00'.repeat(32));
  });

  it('rejects joining a full pot', () => {
    const pot = activePot();

    expect(() => pot.join(mallory)).toThrow('NightPot: pot is not accepting members');
    expect(pot.getLedger().memberCount).toEqual(3n);
  });

  it('puts each member in the tree without publishing who they are', () => {
    const pot = activePot();
    const members = pot.getLedger().members;

    for (const m of [alice, bob, carol]) {
      expect(members.findPathForLeaf(NightPotSimulator.leaf(m))).toBeDefined();
    }
    expect(members.findPathForLeaf(NightPotSimulator.leaf(mallory, 0n))).toBeUndefined();
  });
});

describe('mintTestTokens', () => {
  it('mints exactly one contribution of the pot token', () => {
    const pot = activePot();
    const coin = pot.mintTestTokens(alice);

    expect(coin.value).toEqual(CONTRIBUTION);
    expect(hex(coin.color)).toEqual(hex(pot.getLedger().potColor));
    expect(pot.getLedger().mintCount).toEqual(1n);
  });

  it('never reuses a coin nonce', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);

    expect(hex(pot.mintTestTokens(alice).nonce)).not.toEqual(hex(pot.mintTestTokens(alice).nonce));
  });
});

describe('contribute', () => {
  it('rejects contributions while the pot is still forming', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);
    pot.join(alice);

    expect(() => pot.contribute(alice)).toThrow('NightPot: pot is not active');
  });

  it('adds each contribution to the pot', () => {
    const pot = activePot();

    expect(pot.contribute(alice).paidThisRound).toEqual(1n);
    expect(pot.getLedger().potHasCoin).toBe(true);
    expect(pot.getLedger().pot.value).toEqual(CONTRIBUTION);

    const funded = pot.fundRound([bob, carol]);
    expect(funded.paidThisRound).toEqual(3n);
    expect(funded.pot.value).toEqual(3n * CONTRIBUTION);
  });

  it('records a nullifier for the round, not the member', () => {
    const pot = activePot();
    pot.contribute(alice);

    expect(pot.getLedger().contributions.member(pot.contributionNullifier(alice, 0n))).toBe(true);
    expect(pot.getLedger().contributions.member(pot.contributionNullifier(bob, 0n))).toBe(false);
  });

  it('rejects a second contribution in the same round', () => {
    const pot = activePot();
    pot.contribute(alice);

    expect(() => pot.contribute(alice)).toThrow('NightPot: already contributed this round');
    expect(pot.getLedger().paidThisRound).toEqual(1n);
  });

  it('rejects a non-member', () => {
    const pot = activePot();

    expect(() => pot.contribute(mallory)).toThrow(/NightPot: this member is not in the pot|not a member/);
    expect(pot.getLedger().paidThisRound).toEqual(0n);
  });

  it('rejects the wrong token', () => {
    const pot = activePot();
    const coin = { ...pot.validCoin(), color: new Uint8Array(32).fill(9) };

    expect(() => pot.contribute(alice, coin)).toThrow('NightPot: wrong token');
  });

  it('rejects the wrong amount', () => {
    const pot = activePot();
    const coin = { ...pot.validCoin(), value: CONTRIBUTION - 1n };

    expect(() => pot.contribute(alice, coin)).toThrow('NightPot: wrong contribution amount');
  });
});

describe('claimPayout', () => {
  it('rejects a claim before everyone has paid', () => {
    const pot = activePot();
    pot.fundRound([alice, bob]);

    expect(() => pot.claimPayout(alice)).toThrow('NightPot: round is not fully funded');
  });

  it('rejects a member whose turn it is not', () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);

    expect(() => pot.claimPayout(bob)).toThrow(/NightPot: this member is not in the pot|not a member/);
    expect(pot.getLedger().potHasCoin).toBe(true);
  });

  it('pays the whole pot to the member whose turn it is', () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);

    const payout = pot.claimPayout(alice);
    const state = pot.getLedger();

    expect(payout.value).toEqual(3n * CONTRIBUTION);
    expect(state.potHasCoin).toBe(false);
    expect(state.paidThisRound).toEqual(0n);
    expect(state.round).toEqual(1n);
    expect(state.payouts.member(pot.payoutNullifier(alice, 0n))).toBe(true);
  });

  it('lets members contribute again in the next round', () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);
    pot.claimPayout(alice);

    expect(pot.contribute(alice).paidThisRound).toEqual(1n);
  });

  it('completes the pot after every member has had a turn', () => {
    const pot = activePot();

    for (const recipient of [alice, bob, carol]) {
      pot.fundRound([alice, bob, carol]);
      expect(pot.claimPayout(recipient).value).toEqual(3n * CONTRIBUTION);
    }

    const state = pot.getLedger();
    expect(state.phase).toEqual(Phase.completed);
    expect(state.payouts.size()).toEqual(3n);
    expect(() => pot.contribute(alice)).toThrow('NightPot: pot is not active');
  });
});

describe('privacy: secrets and slots never reach public state', () => {
  it('keeps every member secret out of the serialized ledger', () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);
    pot.claimPayout(alice);

    const serialized = pot.circuitContext.currentQueryContext.state.toString().toLowerCase();
    for (const m of [alice, bob, carol]) {
      expect(serialized).not.toContain(hex(m.secretKey));
    }
  });

  it('derives unlinkable tags for the same member', () => {
    const pot = activePot();
    const tags = [
      hex(NightPotSimulator.leaf(alice)),
      hex(pot.contributionNullifier(alice, 0n)),
      hex(pot.contributionNullifier(alice, 1n)),
      hex(pot.payoutNullifier(alice, 0n)),
    ];

    expect(new Set(tags).size).toEqual(tags.length);
  });

  it('gives the same member different nullifiers in different pots', () => {
    const potA = activePot();
    const potB = new NightPotSimulator(3n, CONTRIBUTION);

    expect(potA.address).not.toEqual(potB.address);
    expect(hex(potA.contributionNullifier(alice, 0n))).not.toEqual(hex(potB.contributionNullifier(alice, 0n)));
  });

  it('exposes only the documented ledger fields', () => {
    expect(Object.keys(activePot().getLedger()).sort()).toEqual(
      [
        'contribution',
        'contributions',
        'maxMembers',
        'memberCount',
        'members',
        'mintCount',
        'mintNonce',
        'paidThisRound',
        'payouts',
        'phase',
        'pot',
        'potColor',
        'potHasCoin',
        'round',
      ].sort(),
    );
  });
});
