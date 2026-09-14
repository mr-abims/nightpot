/**
 * End-to-end run: proves the full NightPot money path (NIGHT in, NIGHT out) on a network.
 *
 *   npm run e2e                     # preprod
 *   npm run e2e -- --network preview
 *
 * Deploys a 2-member pot, joins both members (two member secrets, one wallet),
 * pays 1 NIGHT in for each, and has slot 0 send the pot to the wallet's own
 * address. Every step prints its transaction id and the public ledger, and the
 * results are written to e2e-result.json.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { encodeUserAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';

import { resolveNetwork, getOrCreateWallet, recordDeployment } from '../src/network';
import { createWallet, persistWalletState } from '../src/wallet';
import { witnesses, createNightPotPrivateState, type NightPotPrivateState } from '../src/witnesses';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'nightpotPrivateState';
const POT_SIZE = 2n;
/** 1 NIGHT per round, in its smallest unit. */
const CONTRIBUTION = 1_000_000n;
const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

type Step = { step: string; txId?: string; blockHeight?: number; ms: number; note?: string };
const results: Step[] = [];

async function main(): Promise<void> {
  const argv = process.argv.some((a) => a.startsWith('--network')) ? process.argv : [...process.argv, '--network', 'preprod'];
  const { network, config: networkConfig } = resolveNetwork({ argv });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const zkConfigPath = path.resolve(__dirname, '..', 'managed', 'nightpot');
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  if (!fs.existsSync(path.join(zkConfigPath, 'keys'))) {
    throw new Error('Contract not compiled with proving keys — run: npm run compile');
  }

  const NightPot = await import(pathToFileURL(contractPath).href);
  const compiledContract = CompiledContract.make('nightpot', NightPot.Contract).pipe(
    (CompiledContract.withWitnesses as any)(witnesses),
    (CompiledContract.withCompiledFileAssets as any)(zkConfigPath),
  );

  console.log(`\n─── NightPot end-to-end run on ${network} ───────────────────────\n`);
  console.log('  Syncing wallet (can take several minutes)...');
  const walletCtx = await createWallet({ network, networkConfig, seed: getOrCreateWallet(network).seed });
  await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);
  console.log('  ✓ Synced.\n');

  // A fresh wallet (the local devnet genesis wallet, or a new Preprod wallet) must register
  // its NIGHT for DUST generation before it can pay fees. Same flow as the counter repo's deploy.
  const synced: any = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));
  const unregistered = synced.unshielded.availableCoins.filter((c: any) => !c.meta?.registeredForDustGeneration);
  if (unregistered.length > 0) {
    console.log(`  Registering ${unregistered.length} NIGHT UTXOs for DUST generation...`);
    // The signing callback already signs every input; do not sign the recipe again.
    const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
      unregistered,
      walletCtx.unshieldedKeystore.getPublicKey(),
      (payload: any) => walletCtx.unshieldedKeystore.signData(payload),
    );
    await walletCtx.wallet.submitTransaction(await walletCtx.wallet.finalizeRecipe(recipe));
  }
  if (synced.dust.balance(new Date()) === 0n) {
    console.log('  Waiting for DUST to generate...');
    await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(
        Rx.throttleTime(5000),
        Rx.filter((s: any) => s.isSynced && s.dust.balance(new Date()) > 0n),
      ),
    );
  }
  console.log('  ✓ DUST ready.\n');

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      // Paying NIGHT into the contract spends this wallet's unshielded coins, and each
      // spent coin needs a signature. Without this step the node rejects the
      // transaction (ledger error 192). Transactions with no unshielded inputs are unaffected.
      const signed = await walletCtx.wallet.signRecipe(recipe, (payload: Uint8Array) =>
        walletCtx.unshieldedKeystore.signData(payload),
      );
      return walletCtx.wallet.finalizeRecipe(signed);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'nightpot-state',
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      privateStoragePasswordProvider: () =>
        process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1',
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  // Two members, one wallet: membership is a secret, not a wallet address.
  // Payouts go to the address bound into each seat at join; here, this script's own wallet.
  const payoutAddress = encodeUserAddress(walletCtx.unshieldedKeystore.getAddress());
  const members = [
    { name: 'member-0', secretKey: Uint8Array.from(randomBytes(32)), slot: 0n },
    { name: 'member-1', secretKey: Uint8Array.from(randomBytes(32)), slot: 1n },
  ];
  const actAs = (m: (typeof members)[number]) =>
    providers.privateStateProvider.set(
      PRIVATE_STATE_ID,
      createNightPotPrivateState(m.secretKey, payoutAddress, m.slot) as any,
    );

  /** Run one step with DUST-shortage retries, recording its tx id. */
  async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
    process.stdout.write(`  → ${label}... `);
    const start = Date.now();
    for (let attempt = 1; ; attempt++) {
      try {
        const out: any = await fn();
        const pub = out?.public ?? out?.deployTxData?.public;
        results.push({ step: label, txId: pub?.txId, blockHeight: pub?.blockHeight, ms: Date.now() - start });
        console.log(`ok (${Math.round((Date.now() - start) / 1000)}s) tx=${pub?.txId ?? '-'}`);
        return out;
      } catch (err: any) {
        const msg = `${err?.message ?? err} ${err?.cause?.message ?? ''}`;
        const dust = /Not enough Dust|Insufficient Funds|could not balance dust/i.test(msg);
        if (dust && attempt < 12) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        results.push({ step: label, ms: Date.now() - start, note: `FAILED: ${msg.trim()}` });
        console.log('FAILED');
        throw err;
      }
    }
  }

  const deployed: any = await step('deploy 2-member pot', () =>
    deployContract(providers, {
      compiledContract: compiledContract as any,
      // Seats must fill within two hours; each round lasts an hour. Scripted pots carry no name (zero details commitment).
      args: [POT_SIZE, CONTRIBUTION, BigInt(Math.floor(Date.now() / 1000) + 2 * 3600), 3600n, new Uint8Array(32)],
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: createNightPotPrivateState(members[0].secretKey, payoutAddress, 0n) as NightPotPrivateState,
    }),
  );
  const address: string = deployed.deployTxData.public.contractAddress;
  recordDeployment(network, address, walletCtx.unshieldedKeystore.getBech32Address().toString());
  console.log(`\n  Contract: ${address}\n`);

  const nightBalance = async (): Promise<bigint> => {
    const st: any = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((x: any) => x.isSynced)));
    return (st.unshielded.balances[unshieldedToken().raw] ?? 0n) as bigint;
  };

  const readLedger = async () => {
    const state = await providers.publicDataProvider.queryContractState(address);
    if (!state) throw new Error(`Contract state not found for ${address}`);
    return NightPot.ledger(state.data);
  };
  const logLedger = async (label: string) => {
    const l = await readLedger();
    console.log(
      `    [${label}] phase=${l.phase} members=${l.memberCount}/${l.maxMembers} round=${l.round} ` +
        `paid=${l.paidThisRound} pot=${l.potBalance}`,
    );
    return l;
  };

  for (const m of members) {
    await actAs(m);
    await step(`join as ${m.name}`, () => deployed.callTx.join());
  }
  await logLedger('after joins');


  for (const m of members) {
    await actAs(m);
    await step(`contribute 1 NIGHT as ${m.name}`, () => deployed.callTx.contribute());
  }
  await logLedger('after contributions');

  await actAs(members[0]);
  const nightBefore = await nightBalance();
  await step('claimPayout as member-0 (slot 0) to its bound address', () => deployed.callTx.claimPayout());
  await logLedger('after claim');

  // Fees are paid in DUST, so the wallet's NIGHT must rise by exactly the pot.
  const expected = POT_SIZE * CONTRIBUTION;
  let nightAfter = await nightBalance();
  for (let i = 0; i < 24 && nightAfter - nightBefore < expected; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    nightAfter = await nightBalance();
  }
  console.log(`\n  Wallet NIGHT before payout: ${nightBefore}, after: ${nightAfter}\n`);
  if (nightAfter - nightBefore !== expected) {
    throw new Error(`Payout mismatch: expected +${expected}, observed +${nightAfter - nightBefore}`);
  }
  console.log(`  ✓ Payout of ${expected} arrived at the bound address.\n`);

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
}

main()
  .then(() => {
    fs.writeFileSync('e2e-result.json', `${JSON.stringify({ ok: true, results }, null, 2)}\n`);
    process.exit(0);
  })
  .catch((err) => {
    fs.writeFileSync('e2e-result.json', `${JSON.stringify({ ok: false, error: String(err?.message ?? err), results }, null, 2)}\n`);
    console.error(`\n❌ ${err instanceof Error ? err.message : err}\n`);
    if (process.env.DEBUG_SPIKE) console.error(err?.stack ?? err, err?.cause);
    process.exit(1);
  });
