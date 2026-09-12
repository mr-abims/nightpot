/**
 * Shielded-pot spike: proves the full NightPot money path on a public network.
 *
 *   npm run spike                     # preprod
 *   npm run spike -- --network preview
 *
 * Deploys a 2-member pot, joins both members (two member secrets, one wallet),
 * mints the pot's test token twice, contributes twice, and has slot 0 claim the
 * round. Every step prints its transaction id and the public ledger, and the
 * results are written to spike-result.json.
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

import { resolveNetwork, getOrCreateWallet, recordDeployment } from '../src/network';
import { createWallet, persistWalletState } from '../src/wallet';
import { witnesses, createNightPotPrivateState, type NightPotPrivateState } from '../src/witnesses';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'nightpotPrivateState';
const POT_SIZE = 2n;
const CONTRIBUTION = 100n;
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

  console.log(`\n─── NightPot shielded spike on ${network} ───────────────────────\n`);
  console.log('  Syncing wallet (can take several minutes)...');
  const walletCtx = await createWallet({ network, networkConfig, seed: getOrCreateWallet(network).seed });
  await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);
  console.log('  ✓ Synced.\n');

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
      return walletCtx.wallet.finalizeRecipe(recipe);
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
  const members = [
    { name: 'member-0', secretKey: Uint8Array.from(randomBytes(32)), slot: 0n },
    { name: 'member-1', secretKey: Uint8Array.from(randomBytes(32)), slot: 1n },
  ];
  const actAs = (m: (typeof members)[number]) =>
    providers.privateStateProvider.set(PRIVATE_STATE_ID, createNightPotPrivateState(m.secretKey, m.slot) as any);

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
      args: [POT_SIZE, CONTRIBUTION, Uint8Array.from(randomBytes(32))],
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: createNightPotPrivateState(members[0].secretKey, 0n) as NightPotPrivateState,
    }),
  );
  const address: string = deployed.deployTxData.public.contractAddress;
  recordDeployment(network, address, walletCtx.unshieldedKeystore.getBech32Address().toString());
  console.log(`\n  Contract: ${address}\n`);

  const readLedger = async () => {
    const state = await providers.publicDataProvider.queryContractState(address);
    if (!state) throw new Error(`Contract state not found for ${address}`);
    return NightPot.ledger(state.data);
  };
  const logLedger = async (label: string) => {
    const l = await readLedger();
    console.log(
      `    [${label}] phase=${l.phase} members=${l.memberCount}/${l.maxMembers} round=${l.round} ` +
        `paid=${l.paidThisRound} pot=${l.potHasCoin ? l.pot.value : 0n}`,
    );
    return l;
  };

  for (const m of members) {
    await actAs(m);
    await step(`join as ${m.name}`, () => deployed.callTx.join());
  }
  const active = await logLedger('after joins');
  const colorHex = hex(active.potColor);

  for (const m of members) {
    await actAs(m);
    await step(`mintTestTokens for ${m.name}`, () => deployed.callTx.mintTestTokens());
  }

  process.stdout.write('  → waiting for the wallet to see the minted shielded tokens... ');
  const seen = await Rx.firstValueFrom(
    walletCtx.wallet.state().pipe(
      Rx.filter((s: any) => s.isSynced),
      Rx.map((s: any) => (s.shielded?.balances?.[colorHex] ?? 0n) as bigint),
      Rx.filter((b) => b >= POT_SIZE * CONTRIBUTION),
      Rx.timeout({ first: 240_000, with: () => Rx.of(-1n) }),
    ),
  );
  console.log(seen < 0n ? 'not visible after 4 min (continuing anyway)' : `balance ${seen}`);

  for (const m of members) {
    await actAs(m);
    await step(`contribute as ${m.name}`, () =>
      deployed.callTx.contribute({ nonce: Uint8Array.from(randomBytes(32)), color: active.potColor, value: CONTRIBUTION }),
    );
  }
  await logLedger('after contributions');

  await actAs(members[0]);
  await step('claimPayout as member-0 (slot 0)', () => deployed.callTx.claimPayout());
  await logLedger('after claim');

  const finalState: any = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));
  console.log(`\n  Wallet shielded balance of pot token: ${finalState.shielded?.balances?.[colorHex] ?? 0n}\n`);

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
}

main()
  .then(() => {
    fs.writeFileSync('spike-result.json', `${JSON.stringify({ ok: true, results }, null, 2)}\n`);
    process.exit(0);
  })
  .catch((err) => {
    fs.writeFileSync('spike-result.json', `${JSON.stringify({ ok: false, error: String(err?.message ?? err), results }, null, 2)}\n`);
    console.error(`\n❌ ${err instanceof Error ? err.message : err}\n`);
    if (process.env.DEBUG_SPIKE) console.error(err?.stack ?? err, err?.cause);
    process.exit(1);
  });
