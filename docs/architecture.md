# NightPot architecture

NightPot runs a rotating savings circle (ajo, esusu, chama, tanda, susu) as a single Compact contract on Midnight.
Each pot is its own deployed contract. Members prove membership in zero knowledge, the pot holds NIGHT, and a round
schedule keeps the rotation moving.

## Components

```
┌──────────────────────────── member's browser ─────────────────────────────┐
│  web/ (React)                                                             │
│   ├─ membership.ts   member secret + slot, per pot and wallet, localStorage │
│   ├─ potDetails.ts   name + goal, salted commitment, invite-link fragment   │
│   ├─ witnesses.ts    hands secret, slot, payout address, Merkle path to     │
│   │                  the circuits                                           │
│   ├─ useNightPot.ts  wallet picker, providers, circuit calls (midnight-js)  │
│   └─ your wallet (Lace, 1AM, ...) via DApp Connector: prove, sign, balance  │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ proof + disclosed values (leaves, tags, payout address on claim)
┌───────────────────────────────▼───────────────────────────────────────────┐
│  Midnight                                                                  │
│   contracts/nightpot.compact                                               │
│    ledger: phase, size, contribution, schedule, details commitment,        │
│            members (Merkle tree, depth 8), round, paidThisRound,           │
│            join tags, nullifier sets, missedPayments, skippedRounds,       │
│            potBalance (NIGHT)                                              │
│    circuits: join, contribute, claimPayout, skipRound, cancel              │
└────────────────────────────────────────────────────────────────────────────┘
```

## Lifecycle of one pot

`H` is `persistentHash` with a domain tag; `pot` is the contract's own address.

| Step | Circuit | Private inputs (witnesses) | Public effect |
|------|---------|----------------------------|---------------|
| Create | constructor(size, contribution, joinBy, roundSeconds, detailsCommitment) | none | pot parameters (2 to 64 seats, rounds of one minute to one year), schedule, commitment to name and goal; phase `forming` |
| Take a seat | `join()` | secret, payout address | join tag `H("nightpot:joined:v2", sk, pot)` recorded (one seat per secret); leaf `H("nightpot:member:v2", sk, slot, payout, pot)` inserted; seat count +1; when full: phase `active` |
| Pay in | `contribute()` | secret, slot, payout address, Merkle path | Merkle root checked; nullifier `H("nightpot:contrib:v2", sk, slot, round, pot)` recorded; `receiveUnshielded(nativeToken(), contribution)`; `potBalance` += contribution |
| Take the pot | `claimPayout()` | secret, payout address, Merkle path for the seat whose turn it is | nullifier `H("nightpot:payout:v2", sk, round, pot)` recorded; `sendUnshielded(nativeToken(), potBalance, payout)`; round advances |
| Round overdue | `claimPayout()` after the due time | same | the seat whose turn it is takes whatever was paid; `missedPayments` += unpaid seats |
| Recipient absent | `skipRound()` after due time + one round length | none | `skippedRounds` += 1; NIGHT rolls into the next round. The final round cannot be skipped, so its NIGHT can always be claimed late |
| Pot never fills | `cancel()` after `joinDeadline` | none | phase `cancelled` (no NIGHT is held while forming) |

The creator taking seat 1 is app behaviour: right after deploying, the web app sends a `join()` for the creator. The
contract itself treats the creator like any other member.

## How the money moves

- Contributions are in the smallest NIGHT unit (1 NIGHT = 1,000,000). The contract's `nativeToken()` is the same
  all-zero token id wallets use for tNIGHT (checked against the ledger API's `unshieldedToken()`).
- `contribute()` makes the transaction owe NIGHT to the contract. The wallet balances it by adding the member's NIGHT
  inputs and signing them. In the browser this happens inside `balanceUnsealedTransaction`; the Node script calls
  `signRecipe` itself, without which the node rejects the transaction with ledger error 192
  (`InputsSignaturesLengthMismatch`).
- **The payout address is fixed at join.** It is part of the seat's Merkle leaf, so `claimPayout()` takes no
  arguments and can only send the pot to the wallet that took the seat. Someone who steals a seat secret can pay in
  for that seat, but cannot redirect its payout. The app decodes the connected wallet's `mn_addr…` address into the
  32 `UserAddress` bytes.
- Fees are paid in DUST, which wallets generate from NIGHT.

## Privacy model

**Public:** pot size, contribution, schedule, a salted commitment to the name and goal, seats filled, round, how many
members paid, NIGHT held, missed-payment and skipped-round counts, join tags and nullifiers, and (because Wave 1 moves
unshielded NIGHT) the wallets that pay in and the wallet each pot is sent to.

**Private:** member secrets, the Merkle path in each proof, and the pot's name and goal. Name and goal travel in the
invite link's fragment, which browsers do not send to servers; each member's app recomputes the commitment and checks
it against the chain.

**What that means in Wave 1, stated plainly:**

- Membership and payment rules are enforced in zero knowledge, but the NIGHT transfers link wallets to payments.
- **Turn order is public.** Seat *n* is the *n*-th successful `join()`, and join transactions are ordered on-chain.
  Anyone who can link a join transaction to a person (for example, the creator's join lands right after the deploy)
  knows when that person is paid. The payout for round *r* then confirms which wallet held seat *r*.
- `potBalance` shows exactly how much NIGHT the pot holds each round.

Wave 2 replaces the NIGHT transfers with a shielded pot, replaces join-order seats with a commit-reveal ordering, and
stops keeping the balance as a public counter.

**Authorization:** identity is derived from a witness secret, never from `ownPublicKey()`. There is no admin:
`skipRound()` and `cancel()` can be called by anyone, and only succeed when the schedule allows them.

**Seats and wallets:** the web app stores each seat under the pot and the wallet that took it. Two wallets in one
browser never share a secret. The seat backup contains the secret, so it should be kept like a password.

**Known limits:** block time is approximate, so rounds should last hours or days. Two members joining in the same
block contend for the same seat index; one transaction fails and the app retries it against fresh state.

## Design decisions worth knowing

- **One seat per secret.** `join()` records a join tag derived from the secret and the pot, so one secret can never
  hold two seats (which would let it take several payouts).
- **Pot names are committed, not stored.** A readable name could identify the group; a salted commitment keeps it
  verifiable for members without publishing it.
- **Schedule from ledger values only.** Due times are `joinDeadline + (round + 1) × roundLength`, compared with
  `blockTimeGte` and `blockTimeLt`, so no caller-supplied timestamp is trusted. `roundDeadline` stays internal so it is
  not a callable on-chain circuit.
- **Merkle tree depth 8.** 256 leaves covers the 64-seat maximum with room to spare, while keeping every membership
  proof smaller and faster than a deeper tree.
- **Compiler 0.31.1.** The newest compiler (0.34.0) emits code for compact-runtime 0.19.0, while the stable
  Midnight.js SDK (4.1.1) ships runtime 0.16.0. NightPot pins the pairing that deploys today: `npm run compile` runs
  `compact compile +0.31.1`.
- **Slot = join order (Wave 1).** Seat assignment lives in one place in `join()` so Wave 2 can replace it with a
  commit-reveal fair ordering without touching payments or payouts.
- **Wallet-delegated proving.** The app asks the wallet to prove (`getProvingProvider`), falling back to a prover URL
  the wallet reports or a local proof server.
- **Contract versions.** Leaves and tags carry a `:v2` domain tag. Pots deployed before the v2 contract keep working
  with the contract they were deployed with, but the current app only speaks v2, so new pots are needed.

## Roadmap seams

| Wave | Feature | Where it plugs in |
|------|---------|-------------------|
| 2 | Shielded pot | replace `receiveUnshielded`/`sendUnshielded` in `contribute`/`claimPayout` with a shielded pot coin (`receiveShielded`, `mergeCoinImmediate`, `sendShielded`), and stop exposing `potBalance` as a public counter; this path already ran on a devnet (commit `9c2eba0`) |
| 2 | Fair random payout order | replace slot assignment in `join()` with commit-reveal |
| 2 | Pooled collateral with private refunds | equal collateral at join; missed payments covered from the pool; refunds proven against each round's contribution nullifier |
| 3 | Group-purchasing and investment pools | same seats, nullifiers, and pot; fixed-size units; release by member vote or delivery attestation |
