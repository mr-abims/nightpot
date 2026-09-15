# Wave 1 progress (Aug 27 to Sep 16, 2026)

NightPot is a new project in Wave 1. Everything below was built during this wave.

## Shipped

- **Core contract** (`contracts/nightpot.compact`): pot lifecycle (forming, active, completed, cancelled), seats as
  hidden leaves in a `HistoricMerkleTree`, one seat per secret, per-seat contribution nullifiers, payout nullifiers,
  and a pot that holds NIGHT (`receiveUnshielded` / `sendUnshielded` with `nativeToken()`), paid out only to the wallet
  bound to the seat when it was taken.
- **Round schedule:** a join deadline and a round length set at creation. Overdue rounds pay out what was paid and
  count missed payments; unclaimed rounds can be skipped; unfilled pots can be cancelled. One member who stops paying
  can no longer freeze a pot, and the final round can never be skipped, so no NIGHT is left locked.
- **Private, verifiable pot names and goals:** only a salted SHA-256 commitment is stored on-chain; the text travels in
  the invite link (after `#`) and each member's app checks it against the contract.
- **Simulator test suite** (`tests/`): 46 passing tests across logic, money movement, a dishonest prover, the round
  schedule, and privacy.
- **Web app** (`web/`, route `/app`): works with any Midnight wallet (Lace, 1AM, or another DApp Connector API 4
  wallet) through a wallet picker with install guidance; wallet-delegated proving; create a named pot (the app
  takes seat 1 for the creator right after deploying), copy the address or an invite link, take a seat, pay in tNIGHT, take the pot, skip an
  unclaimed round, cancel an unfilled pot; seats are stored per wallet on the device, with backup and restore; the pot
  view refreshes itself.
- **Landing page** (`web/`, route `/`): the problem, how it works, an honest public-vs-private breakdown, a comparison
  with existing savings-pot projects, architecture, and the Wave 1 to 3 roadmap.
- **Docs:** architecture and privacy model.

## End-to-end run on a local Midnight devnet

`npm run devnet:up && npm run e2e:local` deploys a 2-member pot and runs the full money path in NIGHT.
Contract `766fc3340efcac36d3763e1d54b8d9ce04aa1771ac74fa7eb442505675e1c996` (v2 contract). Full transaction ids in [`docs/devnet-run.json`](devnet-run.json).

| Step | Block | Transaction | Time |
|------|-------|-------------|------|
| deploy 2-member pot | 6750 | `0069ebfe3a77efbdf6…` | 19s |
| join as member-0 | 6753 | `0046fd323dd10b60f2…` | 19s |
| join as member-1 | 6757 | `00314cf5d43529ef97…` | 24s |
| contribute 1 NIGHT as member-0 | 6761 | `005b4080e36e268a0d…` | 24s |
| contribute 1 NIGHT as member-1 | 6765 | `0059e1f30380262eaf…` | 23s |
| claimPayout as member-0 (slot 0) to its bound address | 6770 | `00ea5c7457871ce050…` | 19s |

After the claim the pot is empty and the round advanced to 1. The script checks the wallet's NIGHT balance: the 2 NIGHT
paid in arrived at the address bound to seat 0 (both members were driven by the same script wallet, so its balance
returns to where it started).

## Decisions and changes during the wave

- **Shielded first, then NIGHT for launch.** The first version held the pot as a shielded token and was proven end to
  end on the devnet (commit `9c2eba0`). After testing it as a user, the product direction changed: members should pay
  with NIGHT itself and never mint anything. NIGHT is unshielded, so Wave 1 accepts that payers and recipients are
  visible, and Wave 2 brings the shielded pot back.
- **Wallet choice.** The app started Lace-only and now lists every Midnight wallet in the browser.
- **Seats belong to wallets.** A seat is stored under the pot and the wallet that took it, so two wallets in one
  browser never share a secret.
- **Review fixes before submission.** A full contract review found that one secret could take several seats and that
  skipping the final round locked its NIGHT. The v2 contract adds one-seat-per-secret join tags, binds each seat's
  payout wallet into its leaf (so a leaked secret cannot redirect a payout), forbids skipping the final round, and
  shrinks the member tree to depth 8. The app now reuses one provider set per connection, ignores stale refreshes,
  confirms the seat actually taken after a join, and retries once when another member changed the pot first. The
  v2 contract is not compatible with pots deployed earlier, so a new v2 pot was created on Preprod.
- **Honest privacy.** Turn order follows public join order in Wave 1, and the docs and landing page say so.

## Toolchain findings

- Compact compiler 0.34.0 targets compact-runtime 0.19.0, but the stable Midnight.js SDK (4.1.1) ships runtime 0.16.0.
  NightPot pins compiler 0.31.1 so the contract deploys with the stable SDK.
- The browser bundle must resolve a single `onchain-runtime-v3`; `web/package.json` pins it with an override.
- Midnight.js needs `setNetworkId()` before any wallet or contract call, and its deploy path expects Node's `Buffer`
  in the browser; the app sets both at startup.
- Spending NIGHT from a Node wallet requires signing the balancing recipe (`signRecipe`); without it the node rejects
  the transaction with ledger error 192 (`InputsSignaturesLengthMismatch`). Browser wallets sign during
  `balanceUnsealedTransaction`.
- `nativeToken()` in Compact and `unshieldedToken()` in the ledger API are the same token (all-zero id), so the
  contract takes exactly what wallets hold as tNIGHT.
- A third-party Preprod faucet mirror stalled; the official faucet is https://faucet.preprod.midnight.network.
- A fresh Node wallet sync against Preprod takes hours; the local devnet syncs in seconds.

## Live on Preprod

Both pots were created and run through the web app with real browser wallets. Public state read from the Preprod
indexer is in [`docs/preprod-run.json`](preprod-run.json).

**v2 pot (current contract):** `115707cded2df03570f1dcec362a4c21984566329c7b6e4156abfdb52fe646b3`

| | |
|---|---|
| Contribution per round | 100 tNIGHT, rounds of 30 minutes |
| Seats filled | 1 of 3 (the creator, seated by the app right after deploying); joining open until 22:11 UTC, Sep 15 |
| Join tags recorded | 1 (one seat per secret is enforced on-chain) |
| Latest contract call | `1478084e1861a412…` in block 2,566,008 |

**v1 pot (before the review fixes):** `d85e811431f038a192b85315b815a932f87c11e9f0bd2e0da450fa453e3faebf`

| | |
|---|---|
| Contribution per round | 100 tNIGHT |
| Seats filled | 3 of 3 (pot active) |
| Round 1 | all 3 members paid in; the pot was claimed by seat 1 |
| Round 2 | 1 of 3 paid when read; 100 tNIGHT in the pot |
| Contributions / payouts recorded | 4 / 1 |
| Latest contract call | `0ce7469066d523e2…` in block 2,562,736 |

## Next (Wave 2)

- Shielded pot that hides who pays and who is paid.
- Fair random payout order via commit-reveal.
- Pooled collateral with private refunds.

## Later (Wave 3)

- Private group-purchasing and investment pools on the same primitives, piloted with a real group.
