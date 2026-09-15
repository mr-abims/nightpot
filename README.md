# NightPot

**Rotating savings pots on Midnight. Save together in NIGHT, get paid in turn, and let the contract enforce every rule.**

NightPot brings the rotating savings and credit association (ajo, esusu, chama, tanda, susu, committee) on-chain.
Everyone pays the same amount of NIGHT each round, one member takes the whole pot, and the rotation continues until
everyone has had a turn. A Compact contract enforces the rules, members prove they belong with a zero-knowledge proof
from a secret that never leaves their device, and a round schedule keeps the pot moving even when someone stops paying.

- Contract: [`contracts/nightpot.compact`](contracts/nightpot.compact)
- Tests: [`tests/nightpot.test.ts`](tests/nightpot.test.ts) (46 passing)
- Web app and landing page: [`web/`](web)
- Architecture and privacy model: [`docs/architecture.md`](docs/architecture.md)
- End-to-end devnet run: [`docs/devnet-run.json`](docs/devnet-run.json)
- Live on Preprod: v2 pot `115707cded2d…`, plus an earlier v1 pot run through a paid round with real wallets
  ([`docs/preprod-run.json`](docs/preprod-run.json))

## The problem

Rotating savings circles serve hundreds of millions of people, and they run on trust:

- **The early winner stops paying.** Once a member has taken the pot, only social pressure keeps them paying in.
- **One person holds the cash.** The organizer collects every round and can disappear with it.
- **Everyone knows payout day.** Who got paid, and who missed a payment, travels fast.

## How NightPot works

| Move | Circuit | What the member proves | What the chain records |
|------|---------|------------------------|------------------------|
| Create a pot | constructor | nothing | size, contribution in NIGHT, schedule, a commitment to the name and goal |
| Take a seat | `join()` | nothing; the device creates a secret and binds its payout wallet | a one-seat-per-secret tag and a hidden Merkle leaf; seat count +1 (the app seats the creator right after deploying) |
| Pay in | `contribute()` | "I hold a seat in this pot" | a one-time tag for this round; the contribution moves from the wallet into the pot |
| Take the pot | `claimPayout()` | "I hold the seat whose turn it is" | a one-time payout tag; the pot is sent to the wallet bound to that seat at join |
| Keep it moving | `skipRound()` / `cancel()` | nothing; anyone may call | an unclaimed round rolls forward after a grace period (never the final round); a pot that never fills is cancelled |

Every round has a due date: `joinDeadline + (round + 1) × roundLength`, checked against block time. Once it passes,
the member whose turn it is can take whatever was paid, and the contract counts the missed payments. One member who
stops paying cannot freeze the pot.

### What is public and what is private

| Public on Midnight | Private |
|--------------------|---------|
| Pot size, contribution, schedule | Member secrets |
| Seats filled, current round, members paid this round, NIGHT in the pot | The Merkle path used in each proof |
| Missed-payment and skipped-round counts | The pot's name and goal (only a salted fingerprint is on-chain; the text travels in the invite link) |
| One-time tags (nullifiers) | |
| The wallets that pay in, and the wallet each pot is sent to | |

Wave 1 moves unshielded NIGHT, so payments and payouts are visible, and an observer can tell which wallet received
each round. Turn order is public too: seats follow on-chain join order, so anyone who can tell who joined when (the
creator is seated right after deploying) knows when they are paid. Wave 2 moves the pot to shielded tokens to hide that; a shielded version of the pot already ran end to end
on a devnet earlier in this wave (commit `9c2eba0`).

## Why it is different

| | NightPot | HushPot | Sharibo | Public on-chain circles |
|---|---|---|---|---|
| Members take turns receiving the pot | Yes | No (one-time pot) | Yes | Yes |
| Keeps rotating when a member stops paying | Yes (round deadlines); collateral in Wave 2 | No | No | Partly (collateral) |
| Private, verifiable pot names | Yes | No | No | No |
| Hides who pays in and who gets paid | Wave 2 | Partly | Partly (deposits public) | No |
| Private group-purchasing and investment pools | Wave 3 | No | No | No |

Based on each project's public documentation, September 2026.

## Midnight integration

- **Compact contract** with private witnesses (`memberSecret`, `memberSlot`, `memberPayout`, `memberPath`) and
  deliberate `disclose()` only on values meant to be public (leaves, join tags, nullifiers, the payout address when a
  pot is paid, boolean checks). The payout address is bound into the seat's leaf at join, so a leaked seat secret
  cannot redirect a payout.
- **Dual ledger:** public contract state (phase, counters, `HistoricMerkleTree`, nullifier `Set`s) alongside native
  NIGHT held by the contract through `receiveUnshielded(nativeToken(), …)` and paid out with `sendUnshielded` to a
  `UserAddress`.
- **Identity** is derived from a witness secret with domain-separated `persistentHash`; `ownPublicKey()` is never used
  for authorization.
- **Midnight.js 4.1.1** for deploy and calls, and **any Midnight wallet** (Lace, 1AM, or another DApp Connector API 4
  wallet) for balancing, signing, proving (`getProvingProvider`), and submission in the browser.

## Repository layout

```
contracts/nightpot.compact   the contract
src/witnesses.ts             private state + witness implementations (shared by Node and web)
src/{network,wallet,wallet-state}.ts  Node wallet, network, and wallet cache helpers
scripts/e2e-pot.ts           end-to-end run: deploy, join x2, pay in x2, take the pot
tests/                       simulator + 46 tests (logic, state, adversarial, schedule, privacy)
web/                         landing page (/) and wallet app (/app)
docs/                        architecture, Wave 1 progress, devnet and Preprod runs
```

## Getting started

Prerequisites: Node 22, Docker, the Compact CLI, and a Midnight wallet such as Lace or 1AM (for the web app).

```bash
# Compiler 0.31.1 matches the stable Midnight.js 4.1.1 runtime (see docs/architecture.md)
compact update 0.31.1

npm install
npm run compile        # compact compile +0.31.1 contracts/nightpot.compact managed/nightpot
npm test               # 46 simulator tests
npm run typecheck      # contract bindings, witnesses, tests, and scripts
```

### Run the web app

```bash
cd web
npm install
npm run dev            # copies compiled keys into public/, then starts Vite on :5173
```

Open `http://localhost:5173/app`, pick your Midnight wallet on Preprod, and create a pot with a name, the number of
members, and the tNIGHT each round pays. The app takes seat 1 for you straight after deploying. Copy the invite link for your members; they
take their seats and everyone pays in; the member whose turn it is takes the pot. Get Preprod tNIGHT from
https://faucet.preprod.midnight.network.

### Run the end-to-end script on a local devnet (minutes)

```bash
npm run devnet:up      # node, indexer, proof server in Docker
npm run e2e:local      # deploy, join x2, pay 1 NIGHT in x2, take the pot
```

A recorded run is in [`docs/devnet-run.json`](docs/devnet-run.json).

## Testing

`npm test` runs the real compiled circuits in the Compact runtime simulator with several members sharing one ledger:

- **Logic:** full three-member rotation to completion; rejects joining a full pot, a second seat for the same
  secret, paying while forming, paying twice in a round, non-members, claims before the round is funded, claims by the
  wrong seat, and a second payout. A 64-member pot fills and activates.
- **Money:** every payout's NIGHT amount and destination are read from the circuit's effects and must be the wallet
  bound to the seat.
- **Adversarial:** replaced witnesses feed another member's genuine Merkle path, a forged path, and a stolen secret
  with a different wallet; the contract's own checks reject each one.
- **State:** seat assignment, activation, the NIGHT held in the pot accumulating, resetting after a payout, and rolling
  over after a skipped round.
- **Schedule:** joining closes at the deadline, unfilled pots can be cancelled, overdue rounds pay out what was paid and
  count the missed payments, unclaimed rounds are skipped after a grace period (not a second early), and the final round
  can never be skipped, so its NIGHT is always claimable.
- **Privacy:** member secrets never appear in serialized ledger state; leaves and nullifiers are unlinkable across
  purposes, rounds, and pots; only a commitment to the pot's name is stored; the ledger exposes only documented fields.

## Wave 1 status

See [`docs/wave1-progress.md`](docs/wave1-progress.md).

## Roadmap

- **Wave 2:** shielded pot that hides who pays and who is paid, fair random payout order (commit-reveal), pooled
  collateral with private refunds.
- **Wave 3:** private group-purchasing and investment pools on the same primitives, piloted with a real group.

## License

Apache-2.0. See [LICENSE](LICENSE). Built on [Midnight](https://midnight.network).
