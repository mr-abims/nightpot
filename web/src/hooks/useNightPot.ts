/**
 * Midnight SDK hook for NightPot.
 *
 * Owns the Lace connection, the browser provider set, reading a pot's public
 * state, and the five contract actions (create, mint test tokens, join, pay in,
 * take the pot).
 *
 * Privacy boundary: the member secret and slot come from membership.ts and are
 * handed to the circuits as witnesses. What leaves the browser is a proof, the
 * public arguments (a coin descriptor for pay-in), and the one-way tags the
 * contract writes. "Am I seated / have I paid / is it my turn" is computed
 * locally from public state, because asking the chain would reveal who we are.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  type Binding,
  type FinalizedTransaction,
  type Proof,
  type SignatureEnabled,
  Transaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';

import { Contract, Phase, ledger, pureCircuits } from '../generated/nightpot/contract/index.js';
import { createNightPotPrivateState, witnesses, type NightPotPrivateState } from '../../../src/witnesses';
import { inMemoryPrivateStateProvider } from '../lib/private-state-provider';
import {
  bytesToHex,
  hexToBytes,
  loadMembership,
  randomBytes32,
  saveMembership,
  type Membership,
} from '../lib/membership';

/** The indexer's default socket shim has no browser WebSocket; pass the native one. */
const browserWebSocket = globalThis.WebSocket as unknown as never;

export const NETWORK_ID = import.meta.env.VITE_NETWORK_ID || 'preprod';
const INDEXER_URI = import.meta.env.VITE_INDEXER_URI || 'https://indexer.preprod.midnight.network/api/v4/graphql';
const INDEXER_WS_URI =
  import.meta.env.VITE_INDEXER_WS_URI || 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
const PRIVATE_STATE_ID = 'nightpotPrivateState';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export type ActionName = 'create' | 'mint' | 'join' | 'contribute' | 'claim';
export type ActionState = {
  name: ActionName | null;
  status: 'idle' | 'working' | 'done' | 'error';
  message: string | null;
  txId: string | null;
};

export type MySeat = {
  slot: bigint;
  confirmed: boolean;
  seated: boolean;
  paidThisRound: boolean;
  myTurn: boolean;
  claimed: boolean;
};

export type PotView = {
  address: string;
  phase: 'forming' | 'active' | 'completed';
  maxMembers: bigint;
  contribution: bigint;
  memberCount: bigint;
  round: bigint;
  paidThisRound: bigint;
  potValue: bigint;
  colorHex: string;
  me: MySeat | null;
};

const phaseName = (p: Phase): PotView['phase'] =>
  p === Phase.forming ? 'forming' : p === Phase.active ? 'active' : 'completed';

function describeError(error: unknown): string {
  const err = error as { code?: string; message?: string; reason?: string } | undefined;
  const raw = err?.reason ?? err?.message ?? String(error);
  switch (err?.code) {
    case 'Rejected':
    case 'PermissionRejected':
      return 'The request was rejected in Lace.';
    case 'Disconnected':
      return 'Lace disconnected. Reconnect to continue.';
  }
  const contractMessage = raw.match(/NightPot: ([^"\n]+)/);
  if (contractMessage) return contractMessage[1].charAt(0).toUpperCase() + contractMessage[1].slice(1) + '.';
  if (/Not enough Dust|could not balance dust/i.test(raw)) return 'Your wallet has no DUST for fees yet. Wait for DUST to generate and try again.';
  if (/Insufficient|balance/i.test(raw)) return 'Your wallet does not hold enough of the pot token. Mint test tokens first.';
  return raw;
}

function findWallet(): InitialAPI | undefined {
  if (!window.midnight) return undefined;
  return Object.values(window.midnight).find(
    (w): w is InitialAPI =>
      !!w && typeof w === 'object' && 'apiVersion' in w && String((w as InitialAPI).apiVersion).startsWith('4.'),
  );
}

const potIdBytes = (address: string): Uint8Array => fromHex(address).slice(0, 32);

const compiledContract = () =>
  CompiledContract.make('nightpot', Contract as any).pipe(
    (CompiledContract.withWitnesses as any)(witnesses),
    (CompiledContract.withCompiledFileAssets as any)(window.location.origin),
  );

export function useNightPot(initialAddress: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const [address, setAddress] = useState<string | null>(initialAddress);
  const [pot, setPot] = useState<PotView | null>(null);
  const [potError, setPotError] = useState<string | null>(null);
  const [loadingPot, setLoadingPot] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);

  const [action, setAction] = useState<ActionState>({ name: null, status: 'idle', message: null, txId: null });

  const apiRef = useRef<ConnectedAPI | null>(null);

  const refreshBalance = useCallback(async (colorHex: string | undefined) => {
    const api = apiRef.current;
    if (!api || !colorHex || /^0+$/.test(colorHex)) {
      setTokenBalance(null);
      return;
    }
    try {
      const balances = await api.getShieldedBalances();
      setTokenBalance(balances[colorHex] ?? 0n);
    } catch {
      setTokenBalance(null);
    }
  }, []);

  const readPot = useCallback(
    async (target: string | null = address) => {
      if (!target) return;
      setLoadingPot(true);
      setPotError(null);
      try {
        const config = apiRef.current ? await apiRef.current.getConfiguration() : null;
        const provider = indexerPublicDataProvider(
          config?.indexerUri || INDEXER_URI,
          config?.indexerWsUri || INDEXER_WS_URI,
          browserWebSocket,
        );
        const state = await provider.queryContractState(target);
        if (!state) {
          setPot(null);
          setPotError(`No pot found at that address on ${NETWORK_ID}.`);
          return;
        }
        const l = ledger(state.data);
        const m = loadMembership(target);
        let me: MySeat | null = null;
        if (m) {
          const sk = hexToBytes(m.secretKeyHex);
          const slot = BigInt(m.slot);
          const potId = potIdBytes(target);
          me = {
            slot,
            confirmed: m.confirmed,
            seated: l.members.findPathForLeaf(pureCircuits.memberLeaf(sk, slot)) !== undefined,
            paidThisRound: l.contributions.member(pureCircuits.contributionNullifier(sk, l.round, potId)),
            myTurn: l.phase === Phase.active && slot === l.round,
            claimed: l.payouts.member(pureCircuits.payoutNullifier(sk, slot, potId)),
          };
          if (me.seated && !m.confirmed) saveMembership(target, { ...m, confirmed: true });
        }
        const view: PotView = {
          address: target,
          phase: phaseName(l.phase),
          maxMembers: l.maxMembers,
          contribution: l.contribution,
          memberCount: l.memberCount,
          round: l.round,
          paidThisRound: l.paidThisRound,
          potValue: l.potHasCoin ? l.pot.value : 0n,
          colorHex: bytesToHex(l.potColor),
          me,
        };
        setPot(view);
        void refreshBalance(view.colorHex);
      } catch (error) {
        setPot(null);
        setPotError(describeError(error));
      } finally {
        setLoadingPot(false);
      }
    },
    [address, refreshBalance],
  );

  useEffect(() => {
    void readPot(address);
  }, [address, readPot]);

  const connect = useCallback(async () => {
    setWalletError(null);
    setStatus('connecting');
    try {
      const initial = findWallet();
      if (!initial) {
        throw new Error('No Midnight wallet found. Install Lace with Midnight support, then reload this page.');
      }
      const api = await initial.connect(NETWORK_ID);
      const connection = await api.getConnectionStatus();
      if (connection.status !== 'connected') throw new Error('Lace reports it is not connected. Approve the connection.');
      if (connection.networkId !== NETWORK_ID) {
        throw new Error(`Lace is on ${connection.networkId}. Switch it to ${NETWORK_ID} and reconnect.`);
      }
      const { unshieldedAddress } = await api.getUnshieldedAddress();
      apiRef.current = api;
      setWalletAddress(unshieldedAddress);
      setStatus('connected');
      void readPot();
    } catch (error) {
      apiRef.current = null;
      setWalletAddress(null);
      setStatus('disconnected');
      setWalletError(describeError(error));
    }
  }, [readPot]);

  const disconnect = useCallback(() => {
    apiRef.current = null;
    setWalletAddress(null);
    setStatus('disconnected');
    setTokenBalance(null);
  }, []);

  const buildProviders = useCallback(async (api: ConnectedAPI) => {
    const config = await api.getConfiguration();
    const shielded = await api.getShieldedAddresses();
    const zkConfigProvider = new FetchZkConfigProvider<string>(window.location.origin, fetch.bind(window));
    const proverServerUri =
      (config as { proverServerUri?: string }).proverServerUri ??
      import.meta.env.VITE_PROOF_SERVER_URI ??
      'http://localhost:6300';

    return {
      privateStateProvider: inMemoryPrivateStateProvider<string, NightPotPrivateState>(),
      zkConfigProvider,
      proofProvider: httpClientProofProvider(proverServerUri, zkConfigProvider),
      publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri, browserWebSocket),
      walletProvider: {
        getCoinPublicKey: () => shielded.shieldedCoinPublicKey,
        getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey,
        balanceTx: async (tx: any): Promise<FinalizedTransaction> => {
          const balanced = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
          return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
            'signature',
            'proof',
            'binding',
            fromHex(balanced.tx),
          );
        },
      },
      midnightProvider: {
        submitTx: async (tx: FinalizedTransaction) => {
          await api.submitTransaction(toHex(tx.serialize()));
          return tx.identifiers()[0];
        },
      },
    };
  }, []);

  const openPot = useCallback(
    async (api: ConnectedAPI, target: string, privateState: NightPotPrivateState): Promise<any> =>
      findDeployedContract((await buildProviders(api)) as any, {
        compiledContract: compiledContract() as any,
        contractAddress: target,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: privateState,
      }),
    [buildProviders],
  );

  /** Run one wallet action with consistent status, errors, and a refresh afterwards. */
  const run = useCallback(
    async (name: ActionName, fn: (api: ConnectedAPI) => Promise<{ txId?: string; message: string }>) => {
      const api = apiRef.current;
      if (!api) {
        setAction({ name, status: 'error', message: 'Connect Lace first.', txId: null });
        return;
      }
      setAction({ name, status: 'working', message: null, txId: null });
      try {
        const { txId, message } = await fn(api);
        setAction({ name, status: 'done', message, txId: txId ?? null });
      } catch (error) {
        setAction({ name, status: 'error', message: describeError(error), txId: null });
      } finally {
        void readPot();
      }
    },
    [readPot],
  );

  const createPot = useCallback(
    (size: number, contribution: bigint) =>
      run('create', async (api) => {
        const deployed: any = await deployContract((await buildProviders(api)) as any, {
          compiledContract: compiledContract() as any,
          args: [BigInt(size), contribution, randomBytes32()],
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState: createNightPotPrivateState(randomBytes32()),
        });
        const created: string = deployed.deployTxData.public.contractAddress;
        setAddress(created);
        return { txId: deployed.deployTxData.public.txId, message: 'Pot created. Share its address, then take a seat.' };
      }),
    [run, buildProviders],
  );

  const mintTestTokens = useCallback(
    () =>
      run('mint', async (api) => {
        if (!address) throw new Error('Open a pot first.');
        const m = loadMembership(address);
        const sk = m ? hexToBytes(m.secretKeyHex) : randomBytes32();
        const deployed = await openPot(api, address, createNightPotPrivateState(sk, m ? BigInt(m.slot) : 0n));
        const tx = await deployed.callTx.mintTestTokens();
        return { txId: tx.public.txId, message: 'Test tokens minted to your shielded balance.' };
      }),
    [run, address, openPot],
  );

  const join = useCallback(
    () =>
      run('join', async (api) => {
        if (!address) throw new Error('Open a pot first.');
        const existing = loadMembership(address);
        const sk = existing ? hexToBytes(existing.secretKeyHex) : randomBytes32();
        // The slot is the next free seat; if another join lands first the proof
        // no longer matches the ledger and the transaction is rejected.
        const providers = await buildProviders(api);
        const state = await providers.publicDataProvider.queryContractState(address);
        if (!state) throw new Error('Pot not found.');
        const slot = ledger(state.data).memberCount;
        const membership: Membership = { secretKeyHex: bytesToHex(sk), slot: slot.toString(), confirmed: false };
        // Save before submitting, so a slow confirmation never loses the secret.
        saveMembership(address, membership);
        const deployed = await openPot(api, address, createNightPotPrivateState(sk, slot));
        const tx = await deployed.callTx.join();
        saveMembership(address, { ...membership, confirmed: true });
        return { txId: tx.public.txId, message: `You hold seat ${Number(slot) + 1}. Back it up below.` };
      }),
    [run, address, buildProviders, openPot],
  );

  const contribute = useCallback(
    () =>
      run('contribute', async (api) => {
        if (!address || !pot) throw new Error('Open a pot first.');
        const m = loadMembership(address);
        if (!m) throw new Error('You do not hold a seat in this pot on this device.');
        const deployed = await openPot(api, address, createNightPotPrivateState(hexToBytes(m.secretKeyHex), BigInt(m.slot)));
        const tx = await deployed.callTx.contribute({
          nonce: randomBytes32(),
          color: hexToBytes(pot.colorHex),
          value: pot.contribution,
        });
        return { txId: tx.public.txId, message: `Paid into round ${Number(pot.round) + 1}.` };
      }),
    [run, address, pot, openPot],
  );

  const claimPayout = useCallback(
    () =>
      run('claim', async (api) => {
        if (!address || !pot) throw new Error('Open a pot first.');
        const m = loadMembership(address);
        if (!m) throw new Error('You do not hold a seat in this pot on this device.');
        const deployed = await openPot(api, address, createNightPotPrivateState(hexToBytes(m.secretKeyHex), BigInt(m.slot)));
        const tx = await deployed.callTx.claimPayout();
        return { txId: tx.public.txId, message: `You took the pot for round ${Number(pot.round) + 1}.` };
      }),
    [run, address, pot, openPot],
  );

  return {
    status,
    walletAddress,
    walletError,
    connect,
    disconnect,
    address,
    setAddress,
    pot,
    potError,
    loadingPot,
    refresh: readPot,
    tokenBalance,
    action,
    createPot,
    mintTestTokens,
    join,
    contribute,
    claimPayout,
  };
}
