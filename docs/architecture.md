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
│    circuits: join, contribute, claimPayout, mintTestTokens                │
└───────────────────────────────────────────────────────────────────────────┘
```

## Lifecycle of one pot

| Step | Circuit | Private inputs (witnesses) | Public effect |
|------|---------|----------------------------|---------------|
| Create | constructor(size, contribution, nonceSeed) | none | pot parameters, phase `forming` |
| Take a seat | `join()` | member secret | hidden leaf `H("nightpot:member:v1", sk, slot)` inserted; seat count +1; when full: phase `active`, pot token fixed |
| Get test tokens | `mintTestTokens()` | none | one contribution's worth of the pot token minted to the caller's shielded key |
| Pay in | `contribute(coin)` | secret, slot, Merkle path | Merkle root checked; nullifier `H("nightpot:contrib:v1", pot, round, sk)` recorded; coin received and merged into the pot |
| Take the pot | `claimPayout()` | secret, Merkle path for `slot == round` | nullifier `H("nightpot:payout:v1", pot, round, sk)` recorded; whole pot sent to the caller's own shielded key; round advances |

## Privacy model

**Public:** pot size, contribution amount, pot token, seats filled, round, how many members paid, pot balance,
nullifiers.

**Private:** member secrets, which seat belongs to whom, the Merkle path used in each proof, and any link between two
payments by the same member (nullifiers are domain-separated per purpose, pot, and round).

**Why equal contributions:** the amount a contract receives into a held coin is public on Midnight, so the design
makes every contribution identical. The amount then carries no information; privacy comes from hiding identity.

**Why pull payouts:** a contract sending shielded coins to an arbitrary key does not notify that key. The winner calls
`claimPayout()` themselves and receives the pot at their own coin key, which their wallet already tracks.

**Authorization:** identity is derived from a witness secret, never from `ownPublicKey()`, which is prover-supplied
and only used as the payout recipient.

**Known limits:** in small pots, timing and transaction ordering can hint at identities. The pot balance is public.

## Design decisions worth knowing

- **Pot token set at activation, not in the constructor.** A contract's address is derived from its deploy
  transaction, so `kernel.self()` in the constructor is not the final address. The simulator tests caught this.
- **Compiler 0.31.1.** The newest compiler (0.34.0) emits code for compact-runtime 0.19.0, while the stable
  Midnight.js SDK (4.1.1) ships runtime 0.16.0. NightPot pins the pairing that deploys today.
- **Slot = join order (Wave 1).** Seat assignment lives in one place in `join()` so Wave 2 can replace it with a
  commit-reveal fair ordering without touching payments or payouts.
- **Versioned nullifier domains.** `v1` domains leave room for Wave 2 default marks and Wave 3 completion credentials.

## Roadmap seams

| Wave | Feature | Where it plugs in |
|------|---------|-------------------|
| 2 | Fair random payout order | replace slot assignment in `join()` with commit-reveal |
| 2 | Collateral and private default marks | new nullifier domain + collateral coin per seat |
| 3 | Portable savings credential | completion leaves in a credential tree, proven elsewhere without revealing the pot |
