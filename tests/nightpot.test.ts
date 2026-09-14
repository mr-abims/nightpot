/**
 * Tests for the NightPot contract.
 *
 * What we prove about a savings pot:
 *   1. the rotation works end to end and every rule is enforced (logic),
 *   2. the ledger and the NIGHT paid out are right round by round (state and money),
 *   3. the contract's own checks hold against a dishonest prover (adversarial),
 *   4. one member who stops paying cannot freeze everyone (schedule),
 *   5. member secrets never reach public state (privacy).
 */
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';

import { Phase } from '../managed/nightpot/contract/index.js';
import { NOT_A_MEMBER } from '../src/witnesses.js';
import {
  JOIN_WINDOW,
  NightPotSimulator,
  ROUND_SECONDS,
  T0,
  honestWitnesses,
  member,
  type Member,
} from './nightpot-simulator.js';

/** 1 NIGHT in its smallest unit. */
const CONTRIBUTION = 1_000_000n;
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
  it('opens a forming pot with the chosen size, contribution, schedule, and details', () => {
    const state = new NightPotSimulator(3n, CONTRIBUTION).getLedger();

    expect(state.phase).toEqual(Phase.forming);
    expect(state.maxMembers).toEqual(3n);
    expect(state.contribution).toEqual(CONTRIBUTION);
    expect(state.joinDeadline).toEqual(T0 + JOIN_WINDOW);
    expect(state.roundLength).toEqual(ROUND_SECONDS);
    expect(hex(state.details)).toEqual('05'.repeat(32));
    expect(state.memberCount).toEqual(0n);
    expect(state.round).toEqual(0n);
    expect(state.paidThisRound).toEqual(0n);
    expect(state.missedPayments).toEqual(0n);
    expect(state.skippedRounds).toEqual(0n);
    expect(state.potBalance).toEqual(0n);
  });

  it('starts with no members, join tags, contributions, or payouts', () => {
    const state = new NightPotSimulator(3n, CONTRIBUTION).getLedger();

    expect(state.members.firstFree()).toEqual(0n);
    expect(state.joined.size()).toEqual(0n);
    expect(state.contributions.size()).toEqual(0n);
    expect(state.payouts.size()).toEqual(0n);
  });

  it('stores the details commitment, never the name itself', () => {
    const commitment = new Uint8Array(32).fill(0xab);
    const state = new NightPotSimulator(3n, CONTRIBUTION, { details: commitment }).getLedger();

    expect(hex(state.details)).toEqual('ab'.repeat(32));
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

  it('rejects rounds shorter than a minute', () => {
    expect(() => new NightPotSimulator(3n, CONTRIBUTION, { roundSeconds: 59n })).toThrow(
      'NightPot: a round must last at least a minute',
    );
  });

  it('rejects rounds longer than a year', () => {
    expect(() => new NightPotSimulator(3n, CONTRIBUTION, { roundSeconds: 31_536_001n })).toThrow(
      'NightPot: a round can last at most a year',
    );
  });
});

describe('join', () => {
  it('assigns seats in join order and counts members', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);

    expect(pot.join(alice).memberCount).toEqual(1n);
    expect(pot.join(bob).memberCount).toEqual(2n);

    expect(alice.slot).toEqual(0n);
    expect(bob.slot).toEqual(1n);
    expect(pot.getLedger().phase).toEqual(Phase.forming);
    expect(pot.getLedger().joined.member(pot.joinTag(alice))).toBe(true);
  });

  it('activates the pot when the last seat is taken', () => {
    const state = activePot().getLedger();

    expect(state.memberCount).toEqual(3n);
    expect(state.phase).toEqual(Phase.active);
    expect(state.round).toEqual(0n);
  });

  it('fills and activates a pot at the 64-member maximum', () => {
    const pot = new NightPotSimulator(64n, CONTRIBUTION);
    for (let i = 0; i < 64; i++) {
      pot.join(member(`m${i}`, (i + 16).toString(16).padStart(2, '0')));
    }

    const state = pot.getLedger();
    expect(state.memberCount).toEqual(64n);
    expect(state.phase).toEqual(Phase.active);
  });

  it('rejects joining a full pot', () => {
    const pot = activePot();

    expect(() => pot.join(mallory)).toThrow('NightPot: pot is not accepting members');
    expect(pot.getLedger().memberCount).toEqual(3n);
  });

  it('rejects the same secret taking a second seat', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);
    pot.join(mallory);
    const secondSeat: Member = { ...mallory, slot: undefined };

    expect(() => pot.join(secondSeat)).toThrow('NightPot: this member already holds a seat in this pot');
    expect(pot.getLedger().memberCount).toEqual(1n);
  });

  it('rejects the same secret taking a second seat with a different payout wallet', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);
    pot.join(mallory);
    const sameSecretOtherWallet = member('mallory-2', 'dd');

    expect(() => pot.join(sameSecretOtherWallet)).toThrow('NightPot: this member already holds a seat in this pot');
  });

  it('puts each seat in the tree, bound to its payout wallet, without publishing the secret', () => {
    const pot = activePot();
    const members = pot.getLedger().members;

    for (const m of [alice, bob, carol]) {
      expect(members.findPathForLeaf(pot.leaf(m))).toBeDefined();
    }
    expect(members.findPathForLeaf(pot.leaf(alice, 0n, bob.wallet))).toBeUndefined();
    expect(members.findPathForLeaf(pot.leaf(mallory, 0n))).toBeUndefined();
  });
});

describe('contribute', () => {
  it('rejects contributions while the pot is still forming', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);
    pot.join(alice);

    expect(() => pot.contribute(alice)).toThrow('NightPot: pot is not active');
  });

  it('adds each contribution of NIGHT to the pot', () => {
    const pot = activePot();

    const first = pot.contribute(alice);
    expect(first.paidThisRound).toEqual(1n);
    expect(first.potBalance).toEqual(CONTRIBUTION);

    const funded = pot.fundRound([bob, carol]);
    expect(funded.paidThisRound).toEqual(3n);
    expect(funded.potBalance).toEqual(3n * CONTRIBUTION);
  });

  it('records a tag for the seat and round, not the member', () => {
    const pot = activePot();
    pot.contribute(alice);

    expect(pot.getLedger().contributions.member(pot.contributionNullifier(alice, 0n))).toBe(true);
    expect(pot.getLedger().contributions.member(pot.contributionNullifier(bob, 0n))).toBe(false);
  });

  it('rejects a second contribution from the same seat in the same round', () => {
    const pot = activePot();
    pot.contribute(alice);

    expect(() => pot.contribute(alice)).toThrow('NightPot: already contributed this round');
    expect(pot.getLedger().paidThisRound).toEqual(1n);
    expect(pot.getLedger().potBalance).toEqual(CONTRIBUTION);
  });

  it('rejects a non-member', () => {
    const pot = activePot();
    mallory.slot = 0n;

    expect(() => pot.contribute(mallory)).toThrow(NOT_A_MEMBER);
    expect(pot.getLedger().potBalance).toEqual(0n);
  });

  it('fails loudly when the device has no seat recorded', () => {
    const pot = activePot();
    const forgetful: Member = { ...alice, slot: undefined };

    expect(() => pot.contribute(forgetful)).toThrow('NightPot: no seat is recorded for this pot on this device');
  });

  it('still accepts a late contribution while the overdue round is unclaimed', () => {
    const pot = activePot();
    pot.fundRound([alice, bob]);
    pot.setTime(pot.roundDue(0n) + 1n);

    const state = pot.contribute(carol);
    expect(state.paidThisRound).toEqual(3n);
    expect(state.potBalance).toEqual(3n * CONTRIBUTION);
  });

  it('rejects contributions to a cancelled pot', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);
    pot.join(alice);
    pot.setTime(T0 + JOIN_WINDOW);
    pot.cancel();

    expect(() => pot.contribute(alice)).toThrow('NightPot: pot is not active');
  });
});

describe('claimPayout', () => {
  it('rejects a claim before everyone has paid while the round is still open', () => {
    const pot = activePot();
    pot.fundRound([alice, bob]);

    expect(() => pot.claimPayout(alice)).toThrow('NightPot: round is not fully funded');
  });

  it('rejects a member whose turn it is not', () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);

    expect(() => pot.claimPayout(bob)).toThrow(NOT_A_MEMBER);
    expect(pot.getLedger().potBalance).toEqual(3n * CONTRIBUTION);
  });

  it('sends the whole pot to the payout wallet bound to the seat whose turn it is', () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);

    const paid = pot.claimPayout(alice);
    const state = pot.getLedger();

    expect([...paid.entries()]).toEqual([[alice.walletHex, 3n * CONTRIBUTION]]);
    expect(state.potBalance).toEqual(0n);
    expect(state.paidThisRound).toEqual(0n);
    expect(state.round).toEqual(1n);
    expect(state.missedPayments).toEqual(0n);
    expect(state.payouts.member(pot.payoutNullifier(alice, 0n))).toBe(true);
  });

  it('never pays a different wallet, even to someone holding the seat secret', () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);
    const thief: Member = { ...member('thief', 'a1'), slot: 0n };

    expect(() => pot.claimPayout(thief)).toThrow(NOT_A_MEMBER);
    expect(pot.getLedger().potBalance).toEqual(3n * CONTRIBUTION);
  });

  it('refuses a second payout once the round has been taken', () => {
    const pot = new NightPotSimulator(2n, CONTRIBUTION);
    pot.join(alice);
    pot.join(bob);
    pot.fundRound([alice, bob]);
    pot.claimPayout(alice);

    // Straight away the round has moved on and holds nothing.
    expect(() => pot.claimPayout(alice)).toThrow('NightPot: round is not fully funded');
    // Even once the next round is funded, the seat that was paid cannot take it.
    pot.fundRound([alice, bob]);
    expect(() => pot.claimPayout(alice)).toThrow(NOT_A_MEMBER);
    expect(pot.getLedger().payouts.member(pot.payoutNullifier(alice, 0n))).toBe(true);
    expect(pot.getLedger().potBalance).toEqual(2n * CONTRIBUTION);
  });

  it('lets members contribute again in the next round', () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);
    pot.claimPayout(alice);

    expect(pot.contribute(alice).paidThisRound).toEqual(1n);
  });

  it('pays every member their turn and completes the pot', () => {
    const pot = activePot();

    for (const recipient of [alice, bob, carol]) {
      expect(pot.fundRound([alice, bob, carol]).potBalance).toEqual(3n * CONTRIBUTION);
      expect([...pot.claimPayout(recipient).entries()]).toEqual([[recipient.walletHex, 3n * CONTRIBUTION]]);
    }

    const state = pot.getLedger();
    expect(state.phase).toEqual(Phase.completed);
    expect(state.payouts.size()).toEqual(3n);
    expect(pot.unshieldedSpends()).toEqual(
      new Map([
        [alice.walletHex, 3n * CONTRIBUTION],
        [bob.walletHex, 3n * CONTRIBUTION],
        [carol.walletHex, 3n * CONTRIBUTION],
      ]),
    );
    expect(() => pot.contribute(alice)).toThrow('NightPot: pot is not active');
  });
});

describe("the contract's own checks against a dishonest prover", () => {
  it("rejects another member's genuine Merkle path", () => {
    const pot = activePot();
    mallory.slot = 0n;
    const bobsPath = pot.getLedger().members.findPathForLeaf(pot.leaf(bob))!;
    const hostile = { ...honestWitnesses, memberPath: ({ privateState }: any) => [privateState, bobsPath] } as typeof honestWitnesses;

    expect(() => pot.contribute(mallory, hostile)).toThrow('NightPot: membership proof is for a different member');
    expect(pot.getLedger().potBalance).toEqual(0n);
  });

  it('rejects a forged path whose root is not in the tree', () => {
    const pot = activePot();
    mallory.slot = 0n;
    const hostile = {
      ...honestWitnesses,
      memberPath: ({ privateState }: any, leaf: Uint8Array) => {
        const real = pot.getLedger().members.findPathForLeaf(pot.leaf(alice))!;
        const forged = { leaf, path: real.path.map((e: any) => ({ ...e, sibling: { field: e.sibling.field + 1n } })) };
        return [privateState, forged];
      },
    } as typeof honestWitnesses;

    expect(() => pot.contribute(mallory, hostile)).toThrow('NightPot: not a member of this pot');
  });

  it("rejects a claim built from the recipient's real path but a different payout wallet", () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);
    const alicesPath = pot.getLedger().members.findPathForLeaf(pot.leaf(alice))!;
    const thief: Member = { ...member('thief', 'a1'), slot: 0n };
    const hostile = { ...honestWitnesses, memberPath: ({ privateState }: any) => [privateState, alicesPath] } as typeof honestWitnesses;

    expect(() => pot.claimPayout(thief, hostile)).toThrow('NightPot: membership proof is for a different member');
    expect(pot.unshieldedSpends().size).toEqual(0);
  });
});

describe('schedule: one member who stops paying cannot freeze the pot', () => {
  it('closes joining at the join deadline', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);
    pot.join(alice);
    pot.setTime(T0 + JOIN_WINDOW);

    expect(() => pot.join(bob)).toThrow('NightPot: joining has closed');
  });

  it('refuses to cancel while joining is still open', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);
    pot.join(alice);

    expect(() => pot.cancel()).toThrow('NightPot: joining is still open');
  });

  it('lets anyone cancel a pot that did not fill in time', () => {
    const pot = new NightPotSimulator(3n, CONTRIBUTION);
    pot.join(alice);
    pot.setTime(T0 + JOIN_WINDOW);

    expect(pot.cancel().phase).toEqual(Phase.cancelled);
    expect(() => pot.join(bob)).toThrow('NightPot: pot is not accepting members');
  });

  it('refuses to cancel a pot that filled', () => {
    const pot = activePot();
    pot.setTime(T0 + JOIN_WINDOW);

    expect(() => pot.cancel()).toThrow('NightPot: only a forming pot can be cancelled');
  });

  it('lets the recipient take what was paid once the round is due, counting the missed payment', () => {
    const pot = activePot();
    expect(pot.fundRound([alice, bob]).potBalance).toEqual(2n * CONTRIBUTION);
    pot.setTime(pot.roundDue(0n));

    expect([...pot.claimPayout(alice).entries()]).toEqual([[alice.walletHex, 2n * CONTRIBUTION]]);
    const state = pot.getLedger();
    expect(state.potBalance).toEqual(0n);
    expect(state.round).toEqual(1n);
    expect(state.missedPayments).toEqual(1n);
  });

  it('refuses a claim when nobody paid, even after the round is due', () => {
    const pot = activePot();
    pot.setTime(pot.roundDue(0n));

    expect(() => pot.claimPayout(alice)).toThrow('NightPot: nothing was paid this round');
  });

  it('refuses to skip one second before the grace period ends', () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);
    pot.setTime(pot.roundDue(0n) + ROUND_SECONDS - 1n);

    expect(() => pot.skipRound()).toThrow('NightPot: the recipient can still claim this round');
  });

  it('skips an unclaimed round after the grace period and rolls the NIGHT forward', () => {
    const pot = activePot();
    pot.fundRound([alice, bob, carol]);
    pot.setTime(pot.roundDue(0n) + ROUND_SECONDS);

    const skipped = pot.skipRound();
    expect(skipped.skippedRounds).toEqual(1n);
    expect(skipped.round).toEqual(1n);
    expect(skipped.potBalance).toEqual(3n * CONTRIBUTION);

    expect(pot.fundRound([alice, bob, carol]).potBalance).toEqual(6n * CONTRIBUTION);
    expect([...pot.claimPayout(bob).entries()]).toEqual([[bob.walletHex, 6n * CONTRIBUTION]]);
  });

  it('never skips the final round, so its NIGHT can always be claimed late', () => {
    const pot = new NightPotSimulator(2n, CONTRIBUTION);
    pot.join(alice);
    pot.join(bob);
    pot.fundRound([alice, bob]);
    pot.setTime(pot.roundDue(0n) + ROUND_SECONDS);
    pot.skipRound();

    pot.setTime(pot.roundDue(1n) + 10n * ROUND_SECONDS);
    expect(() => pot.skipRound()).toThrow('NightPot: the final round cannot be skipped');
    expect(pot.getLedger().potBalance).toEqual(2n * CONTRIBUTION);

    expect([...pot.claimPayout(bob).entries()]).toEqual([[bob.walletHex, 2n * CONTRIBUTION]]);
    expect(pot.getLedger().phase).toEqual(Phase.completed);
    expect(pot.getLedger().potBalance).toEqual(0n);
  });
});

describe('privacy: secrets never reach public state', () => {
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
      hex(pot.leaf(alice)),
      hex(pot.joinTag(alice)),
      hex(pot.contributionNullifier(alice, 0n)),
      hex(pot.contributionNullifier(alice, 1n)),
      hex(pot.payoutNullifier(alice, 0n)),
    ];

    expect(new Set(tags).size).toEqual(tags.length);
  });

  it('gives the same member different tags in different pots', () => {
    const potA = activePot();
    const potB = new NightPotSimulator(3n, CONTRIBUTION);

    expect(potA.address).not.toEqual(potB.address);
    expect(hex(potA.joinTag(alice))).not.toEqual(hex(potB.joinTag(alice)));
    expect(hex(potA.contributionNullifier(alice, 0n))).not.toEqual(hex(potB.contributionNullifier(alice, 0n)));
    expect(hex(potA.leaf(alice))).not.toEqual(hex(potB.leaf(alice)));
  });

  it('exposes only the documented ledger fields', () => {
    expect(Object.keys(activePot().getLedger()).sort()).toEqual(
      [
        'contribution',
        'contributions',
        'details',
        'joinDeadline',
        'joined',
        'maxMembers',
        'memberCount',
        'members',
        'missedPayments',
        'paidThisRound',
        'payouts',
        'phase',
        'potBalance',
        'round',
        'roundLength',
        'skippedRounds',
      ].sort(),
    );
  });
});
