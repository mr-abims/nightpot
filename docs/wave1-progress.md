# Wave 1 progress (Aug 27 to Sep 16, 2026)

NightPot is a new project in Wave 1. Everything below was built during this wave.

## Shipped

- **Core contract** (`contracts/nightpot.compact`): pot lifecycle (forming, active, completed, cancelled), anonymous seats in a
  `HistoricMerkleTree`, per-round contribution nullifiers, payout nullifiers, a shielded pot coin, pull payouts to the
  winner's own key, and a test-token faucet for Preprod.
- **Round schedule:** a join deadline and a round length set at creation. Overdue rounds pay out what was paid and
  count missed payments without naming anyone; unclaimed rounds can be skipped; unfilled pots can be cancelled. One
  member who stops paying can no longer freeze a pot.
- **Simulator test suite** (`tests/`): 37 passing tests across logic, state transitions, the round schedule, and privacy.
- **Bug caught by tests:** the pot token id was first derived in the constructor, where `kernel.self()` is not yet the
  contract's final address. It now derives at activation, with a test guarding it.
- **Web app** (`web/`, route `/app`): Lace detection with install, update, and connect guidance on Preprod, open or create a pot, take a seat, mint test tokens,
  pay in, take the pot, live public state next to on-device state, and seat backup and restore.
- **Landing page** (`web/`, route `/`): the problem, how it works, the privacy model, a comparison with existing
  savings-pot projects, architecture, and the Wave 1 to 3 roadmap. Light and dark, responsive, reduced-motion aware.
- **Docs:** architecture and privacy model, pitch deck outline, demo video script.

## Toolchain findings

- Compact compiler 0.34.0 targets compact-runtime 0.19.0, but the stable Midnight.js SDK (4.1.1) ships runtime 0.16.0.
  NightPot pins compiler 0.31.1 so the contract deploys with the stable SDK.
- The browser bundle must resolve a single `onchain-runtime-v3`; `web/package.json` pins it with an override.

## Preprod

<!-- Fill in after the end-to-end run: contract address and transaction ids for deploy, join, mint, contribute, claim. -->
Pending.

## Next (Wave 2)

- Fair random payout order via commit-reveal.
- Pooled collateral with private refunds.
- Pot invites and discovery.

## Later (Wave 3)

- Private group-purchasing and investment pools on the same primitives, piloted with a real group.
