# NightPot

**Rotating savings pots on Midnight. Save together, get paid in turn, and keep who you are private.**

NightPot brings the rotating savings and credit association (ajo, esusu, chama, tanda, susu, committee) on-chain
without putting its members on display. Everyone pays the same amount each round, one member takes the whole pot,
and the rotation continues until everyone has had a turn. A Compact contract enforces the rules; zero-knowledge
proofs keep members anonymous; the pot moves as shielded tokens.

- Contract: [`contracts/nightpot.compact`](contracts/nightpot.compact)
- Tests: [`tests/nightpot.test.ts`](tests/nightpot.test.ts) (37 passing)
- Web app and landing page: [`web/`](web)
- Architecture and privacy model: [`docs/architecture.md`](docs/architecture.md)

## The problem

Rotating savings circles serve hundreds of millions of people, and they run on trust:

- **The early winner stops paying.** Once a member has taken the pot, only social pressure keeps them paying in.
- **One person holds the cash.** The organizer collects every round and can disappear with it.
- **Everyone knows payout day.** Who got paid, and who missed a payment, travels fast.

Public-chain savings circles fix the cash box but make every payment, payout, and default permanent and searchable.

## How NightPot works

| Move | Circuit | What the member proves | What the chain records |
|------|---------|------------------------|------------------------|
| Take a seat | `join()` | nothing yet; the device creates a secret | a hidden Merkle leaf; seat count +1 |
| Pay in | `contribute(coin)` | "I hold a seat in this pot" | a one-time tag for this round; the coin joins the pot |
| Take the pot | `claimPayout()` | "I hold the seat whose turn it is" | a one-time payout tag; the whole pot goes to the caller's own shielded key |
| Keep it moving | `skipRound()` / `cancel()` | nothing | an unclaimed round rolls forward after a grace period; a pot that never fills is cancelled |
| Get test tokens | `mintTestTokens()` | nothing | one contribution's worth of the pot token (Preprod testing only) |

Every round has a due date: `joinDeadline + (round + 1) × roundLength`, checked against block time. Once it passes,
the member whose turn it is can take whatever was paid, and the contract counts the missed payments without recording
whose they were. One member who stops paying cannot freeze the pot.

### What is public and what is private

| Public on Midnight | Private to each member |
|--------------------|------------------------|
| Pot size, contribution amount, pot token | The member secret |
| Seats filled, current round, members paid this round | Which seat (and so which turn) is theirs |
| Pot balance, missed-payment and skipped-round counts | The Merkle path used in each proof |
| One-time tags (nullifiers) | Any link between two payments by the same member |

Contributions are deliberately equal: the amount a contract receives into a held coin is public on Midnight, so
uniform amounts carry no information. Payouts are pulled by the winner to their own key, because a contract's
shielded send to an arbitrary key does not notify that key. In very small pots, timing can still hint at identities.

## Why it is different

| | NightPot | HushPot | Sharibo | Public on-chain circles |
|---|---|---|---|---|
| Members take turns receiving the pot | Yes | No (one-time pot) | Yes | Yes |
| Hides who pays in and who gets paid | Yes | Partly | Partly (deposits public) | No |
| Contributions move as shielded tokens | Yes | No | No (Stellar) | No |
| Keeps rotating when a member stops paying | Yes (round deadlines); collateral in Wave 2 | No | No | Partly (collateral) |
| Private group-purchasing and investment pools | Wave 3 | No | No | No |

Based on each project's public documentation, September 2026.

## Midnight integration

- **Compact contract** with private witnesses (`memberSecret`, `memberSlot`, `memberPath`) and deliberate
  `disclose()` only on values meant to be public (leaves, nullifiers, coin descriptors, boolean checks).
- **Dual ledger:** public contract state (phase, counters, `HistoricMerkleTree`, nullifier `Set`s) plus a shielded
  coin held by the contract (`receiveShielded`, `mergeCoinImmediate`, `sendShielded`, `mintShieldedToken`).
- **Identity** is derived from a witness secret with domain-separated `persistentHash`; `ownPublicKey()` is used only
  as a payout recipient, never for authorization.
- **Midnight.js 4.1.1** for deploy and calls; **Lace** via the DApp Connector API 4.0.1 for balancing, proving, and
  submission in the browser.

## Repository layout

```
contracts/nightpot.compact   the contract
src/witnesses.ts             private state + witness implementations (shared by Node and web)
src/{network,wallet}.ts      Node wallet and network helpers
scripts/spike-shielded.ts    end-to-end run on Preprod: deploy, join x2, mint, pay in x2, claim
tests/                       simulator + 37 tests (logic, state, schedule, privacy)
web/                         landing page (/) and Lace app (/app)
docs/                        architecture, deck outline, video script, Wave 1 progress
```

## Getting started

Prerequisites: Node 22, Docker, the Compact CLI, and Lace (for the web app).

```bash
# Compiler 0.31.1 matches the stable Midnight.js 4.1.1 runtime (see docs/architecture.md)
compact update 0.31.1

npm install
npm run compile        # compact compile +0.31.1 contracts/nightpot.compact managed/nightpot
npm test               # 37 simulator tests
```

### Run the web app

```bash
cd web
npm install
npm run dev            # copies compiled keys into public/, then starts Vite on :5173
```

Open `http://localhost:5173/app`, connect Lace on Preprod, create a pot, take a seat, mint test tokens, pay in, and
take the pot when it is your turn. Lace's configured prover generates the proofs.

### Run the end-to-end script on a local devnet (minutes)

```bash
npm run devnet:up      # node, indexer, proof server in Docker
npm run spike:local    # deploy, join x2, mint x2, pay in x2, take the pot
```

A recorded run is in [`docs/devnet-run.json`](docs/devnet-run.json): 8 transactions, each confirmed in 17 to 31 seconds.

### Run the end-to-end script on Preprod

```bash
docker compose up -d proof-server
npm run spike          # uses a Preprod wallet from .midnight-state.json or MIDNIGHT_WALLET_MNEMONIC
```

## Testing

`npm test` runs the real compiled circuits in the Compact runtime simulator with several members sharing one ledger:

- **Logic:** full three-member rotation to completion; rejects joining a full pot, paying while forming, double
  payments, non-members, wrong token, wrong amount, claims before the round is funded, and claims by the wrong seat.
- **State:** seat assignment, activation, pot balance accumulation, round advance, completion.
- **Schedule:** joining closes at the deadline, unfilled pots can be cancelled, overdue rounds pay out what was paid
  and count the missed payments, unclaimed rounds are skipped after a grace period, and a pot runs to completion even
  if nobody shows up.
- **Privacy:** member secrets never appear in serialized ledger state; leaves and nullifiers are unlinkable across
  purposes, rounds, and pots; the ledger exposes only documented fields.

## Wave 1 status

See [`docs/wave1-progress.md`](docs/wave1-progress.md).

## Roadmap

- **Wave 2:** fair random payout order (commit-reveal), pooled collateral with private refunds (members prove they
  paid every round to reclaim it), pot invites.
- **Wave 3:** private group-purchasing and investment pools on the same primitives (fixed-size units keep amounts
  private), piloted with a real group.

## License

Apache-2.0. See [LICENSE](LICENSE). Built on [Midnight](https://midnight.network).
