# NightPot architecture

NightPot runs a rotating savings circle (ajo, esusu, chama, tanda, susu) as a single Compact contract on Midnight.
Each pot is its own deployed contract. Members are anonymous, contributions and payouts move as shielded tokens,
and every rule is enforced inside zero-knowledge circuits.

## Components

```
┌──────────────────────────── member's browser ────────────────────────────┐
│  web/ (React)                                                            │
│   ├─ membership.ts      member secret + slot, per pot, in localStorage    │
│   ├─ witnesses.ts       hands secret, slot, Merkle path to the circuits   │
│   ├─ useNightPot.ts     builds providers, calls circuits via midnight-js  │
│   └─ Lace (DApp Connector)  balances, proves via its prover, submits      │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ proof + public arguments only
┌───────────────────────────────▼──────────────────────────────────────────┐
│  Midnight (Preprod)                                                       │
│   contracts/nightpot.compact                                              │
│    ledger: phase, size, contribution, potColor, members (Merkle tree),    │
│            round, paidThisRound, contributions/payouts (nullifier sets),  │
│            pot (shielded coin held by the contract)                       │
│    circuits: join, contribute, claimPayout, skipRound, cancel, mint       │
└───────────────────────────────────────────────────────────────────────────┘
```

## Lifecycle of one pot

| Step | Circuit | Private inputs (witnesses) | Public effect |
|------|---------|----------------------------|---------------|
| Create | constructor(size, contribution, nonceSeed, joinBy, roundSeconds) | none | pot parameters and schedule, phase `forming` |
| Take a seat | `join()` | member secret | hidden leaf `H("nightpot:member:v1", sk, slot)` inserted; seat count +1; when full: phase `active`, pot token fixed |
| Get test tokens | `mintTestTokens()` | none | one contribution's worth of the pot token minted to the caller's shielded key |
| Pay in | `contribute(coin)` | secret, slot, Merkle path | Merkle root checked; nullifier `H("nightpot:contrib:v1", pot, round, sk)` recorded; coin received and merged into the pot |
| Take the pot | `claimPayout()` | secret, Merkle path for `slot == round` | nullifier `H("nightpot:payout:v1", pot, round, sk)` recorded; whole pot sent to the caller's own shielded key; round advances |
| Round overdue | `claimPayout()` after the due time | secret, Merkle path | recipient takes whatever was paid; `missedPayments` += unpaid seats |
| Recipient absent | `skipRound()` after due time + one round length | none | `skippedRounds` += 1; pot rolls into the next round |
| Pot never fills | `cancel()` after `joinDeadline` | none | phase `cancelled` (no funds are held while forming) |

## Privacy model

**Public:** pot size, contribution amount, pot token, schedule, seats filled, round, how many members paid, pot
balance, missed-payment and skipped-round counts, nullifiers.

**Private:** member secrets, which seat belongs to whom, the Merkle path used in each proof, and any link between two
payments by the same member (nullifiers are domain-separated per purpose, pot, and round).

**Why equal contributions:** the amount a contract receives into a held coin is public on Midnight, so the design
makes every contribution identical. The amount then carries no information; privacy comes from hiding identity.

**Why pull payouts:** a contract sending shielded coins to an arbitrary key does not notify that key. The winner calls
`claimPayout()` themselves and receives the pot at their own coin key, which their wallet already tracks.

**Authorization:** identity is derived from a witness secret, never from `ownPublicKey()`, which is prover-supplied
and only used as the payout recipient.

**Known limits:** in small pots, timing and transaction ordering can hint at identities. The pot balance is public.
Block time is approximate, so rounds should last hours or days. If the final round is skipped, whatever sits in the
pot stays locked until Wave 2 adds collateral refunds.

## Design decisions worth knowing

- **Pot token set at activation, not in the constructor.** A contract's address is derived from its deploy
  transaction, so `kernel.self()` in the constructor is not the final address. The simulator tests caught this.
- **Compiler 0.31.1.** The newest compiler (0.34.0) emits code for compact-runtime 0.19.0, while the stable
  Midnight.js SDK (4.1.1) ships runtime 0.16.0. NightPot pins the pairing that deploys today.
- **Slot = join order (Wave 1).** Seat assignment lives in one place in `join()` so Wave 2 can replace it with a
  commit-reveal fair ordering without touching payments or payouts.
- **Versioned nullifier domains.** `v1` domains leave room for Wave 2 collateral refunds.
- **Schedule from ledger values only.** Due times are `joinDeadline + (round + 1) × roundLength`, compared with
  `blockTimeGte` and `blockTimeLt`, so no caller-supplied timestamp is trusted.

## Roadmap seams

| Wave | Feature | Where it plugs in |
|------|---------|-------------------|
| 2 | Fair random payout order | replace slot assignment in `join()` with commit-reveal |
| 2 | Pooled collateral with private refunds | equal collateral at join; missed payments covered from the pool; refunds proven against each round's contribution nullifier |
| 3 | Group-purchasing and investment pools | same seats, nullifiers, and shielded pot; fixed-size units keep amounts private; release by member vote or delivery attestation |
