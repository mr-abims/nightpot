/**
 * Midnight SDK hook for NightPot.
 *
 * Owns the wallet connection (detection of every Midnight wallet, choosing one,
 * connect, auto-reconnect), one provider set per connection, reading a pot's
 * public state, and the contract actions (create, join, pay in, take the pot,
 * skip a round, cancel).
 *
 * Wallets: any extension implementing the Midnight DApp Connector API injects an
 * InitialAPI under its own key in window.midnight (Lace, 1AM, and others). We
 * list them all and let the member choose; nothing here is wallet-specific.
 *
 * Privacy boundary: the member secret and seat come from membership.ts and are
 * handed to the circuits as witnesses, together with the connected wallet's
 * address, which the contract binds into the seat so payouts can only go there.
 * What leaves the browser is a proof and the one-way tags the contract writes.
 * "Am I seated / have I paid / is it my turn" is computed locally from public
 * state, because asking the chain would reveal who we are.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { dappConnectorProofProvider } from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  type Binding,
  CostModel,
  type FinalizedTransaction,
  type Proof,
  type SignatureEnabled,
  Transaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';

import { Contract, Phase, ledger, pureCircuits, type Ledger } from '../generated/nightpot/contract/index.js';
import { createNightPotPrivateState, witnesses, type NightPotPrivateState } from '../../../src/witnesses';
import { inMemoryPrivateStateProvider } from '../lib/private-state-provider';
import {
  bytesToHex,
  clearLegacyMembership,
  hexToBytes,
  loadLegacyMembership,
  loadMembership,
  randomBytes32,
  saveMembership,
  type Membership,
} from '../lib/membership';
import { commitDetails, loadDetails, newDetails, saveDetails, type PotDetails } from '../lib/potDetails';
import { formatNight, NIGHT_BALANCE_KEY, userAddressBytes } from '../lib/night';

/** The indexer's default socket shim has no browser WebSocket; pass the native one. */
const browserWebSocket = globalThis.WebSocket as unknown as never;

export const NETWORK_ID = import.meta.env.VITE_NETWORK_ID || 'preprod';
const INDEXER_URI = import.meta.env.VITE_INDEXER_URI || 'https://indexer.preprod.midnight.network/api/v4/graphql';
const INDEXER_WS_URI =
  import.meta.env.VITE_INDEXER_WS_URI || 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
const PRIVATE_STATE_ID = 'nightpotPrivateState';
const REQUIRED_CONNECTOR_MAJOR = '4.';
/** Stores the id of the wallet the member last connected with; absent means no auto-reconnect. */
const WALLET_PREF_KEY = 'nightpot:wallet';

// Midnight.js keeps the network id in module state and refuses wallet or contract
// operations until it is set. Set the target network now; connect() re-sets it from
// what the wallet reports.
setNetworkId(NETWORK_ID as Parameters<typeof setNetworkId>[0]);

/** Wallet extensions inject window.midnight shortly after load, sometimes one after another. */
const DETECT_ATTEMPTS = 12;
const DETECT_SETTLE_ATTEMPTS = 4;
const DETECT_INTERVAL_MS = 250;
const REFRESH_INTERVAL_MS = 10_000;

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
/** checking: still polling; missing: no Midnight wallet; outdated: wallets found, none speak API v4. */
export type WalletAvailability = 'checking' | 'missing' | 'outdated' | 'available';
export type WalletOption = {
  /** The key the wallet is injected under in window.midnight. */
  id: string;
  name: string;
  icon: string;
  rdns: string;
  apiVersion: string;
  compatible: boolean;
};
export type ActionName = 'create' | 'join' | 'contribute' | 'claim' | 'skip' | 'cancel';
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
  /** This seat's own round has already been paid out. */
  claimed: boolean;
  /** Not on-chain, and the join failed or has been pending too long: taking the seat can be retried. */
  retryable: boolean;
};

export type PotView = {
  address: string;
  phase: 'forming' | 'active' | 'completed' | 'cancelled';
  maxMembers: bigint;
  contribution: bigint;
  memberCount: bigint;
  round: bigint;
  paidThisRound: bigint;
  /** NIGHT held in the pot, in the smallest unit. */
  potValue: bigint;
  /** Seconds since the Unix epoch; seats must be filled before this. */
  joinDeadline: bigint;
  roundLength: bigint;
  /** When the current round falls due; null unless the pot is active. */
  roundDue: bigint | null;
  missedPayments: bigint;
  skippedRounds: bigint;
  me: MySeat | null;
  /** Name and goal from the invite link or this device, checked against the on-chain commitment. */
  details: (PotDetails & { verified: boolean }) | null;
};

export type CreatePotInput = {
  name: string;
  goal: string;
  size: number;
  contribution: bigint;
  joinWithinSeconds: number;
  roundSeconds: number;
};

const phaseName = (p: Phase): PotView['phase'] =>
  p === Phase.forming ? 'forming' : p === Phase.active ? 'active' : p === Phase.completed ? 'completed' : 'cancelled';

const readWalletPref = (): string | null => {
  try {
    return window.localStorage.getItem(WALLET_PREF_KEY);
  } catch {
    return null;
  }
};
const writeWalletPref = (id: string | null): void => {
  try {
    if (id) window.localStorage.setItem(WALLET_PREF_KEY, id);
    else window.localStorage.removeItem(WALLET_PREF_KEY);
  } catch {
    // Storage unavailable: the member simply chooses a wallet each visit.
  }
};

const errorText = (error: unknown): string => {
  const err = error as { message?: string; reason?: string } | undefined;
  return err?.reason ?? err?.message ?? String(error);
};

/** The transaction was built against state that changed before it landed (another member acted first). */
const isStateConflict = (error: unknown): boolean => /1010|Invalid Transaction|out of date|stale/i.test(errorText(error));

function describeError(error: unknown): string {
  const code = (error as { code?: string } | undefined)?.code;
  const raw = errorText(error);
  switch (code) {
    case 'Rejected':
    case 'PermissionRejected':
      return 'The request was rejected in your wallet.';
    case 'Disconnected':
      return 'Your wallet disconnected. Reconnect to continue.';
  }
  const contractMessage = raw.match(/NightPot: ([^"\n]+)/);
  if (contractMessage) return contractMessage[1].charAt(0).toUpperCase() + contractMessage[1].slice(1) + '.';
  if (/Not enough Dust|could not balance dust/i.test(raw)) return 'Your wallet has no DUST for fees yet. Wait for DUST to generate and try again.';
  if (/Insufficient|balance/i.test(raw)) return 'Your wallet does not hold enough tNIGHT for this payment. Get more from the faucet.';
  if (/Failed to fetch|NetworkError|ECONNREFUSED|localhost:6300|proof server/i.test(raw)) {
    return 'Could not reach a prover. Use a wallet that proves in the browser (for example Lace or 1AM), or run a local proof server.';
  }
  if (isStateConflict(error)) return 'Someone else changed the pot at the same moment. Try again.';
  return raw;
}

/**
 * Every injected Midnight wallet. Some wallets also install a convenience alias
 * (Lace adds window.midnight.mnLace), so entries with the same rdns and name
 * are collapsed, preferring the non-alias key.
 */
function listWallets(): WalletOption[] {
  if (!window.midnight) return [];
  const byIdentity = new Map<string, WalletOption>();
  for (const [id, w] of Object.entries(window.midnight)) {
    if (!w || typeof w !== 'object' || typeof (w as InitialAPI).connect !== 'function') continue;
    const api = w as InitialAPI;
    const option: WalletOption = {
      id,
      name: String(api.name ?? id),
      icon: String(api.icon ?? ''),
      rdns: String(api.rdns ?? ''),
      apiVersion: String(api.apiVersion ?? 'unknown'),
      compatible: String(api.apiVersion ?? '').startsWith(REQUIRED_CONNECTOR_MAJOR),
    };
    const identity = `${option.rdns}|${option.name}`;
    const existing = byIdentity.get(identity);
    if (!existing || existing.id.startsWith('mn')) byIdentity.set(identity, option);
  }
  return [...byIdentity.values()].sort((a, b) => Number(b.compatible) - Number(a.compatible) || a.name.localeCompare(b.name));
}

const getInitialApi = (id: string): InitialAPI | undefined => {
  const w = window.midnight?.[id];
  return w && typeof (w as InitialAPI).connect === 'function' ? (w as InitialAPI) : undefined;
};

/**
 * Proving, in order of preference:
 *   1. the wallet proves through the DApp Connector (getProvingProvider); in-browser
 *      provers such as 1AM work this way, and it keeps witnesses on the device;
 *   2. a prover server the wallet reports (proverServerUri, deprecated in the connector API);
 *   3. VITE_PROOF_SERVER_URI, or a proof server on this machine.
 */
async function createProofProvider(
  api: ConnectedAPI,
  zkConfigProvider: FetchZkConfigProvider<string>,
  config: { proverServerUri?: string },
) {
  if (typeof (api as { getProvingProvider?: unknown }).getProvingProvider === 'function') {
    try {
      return await dappConnectorProofProvider(api, zkConfigProvider, CostModel.initialCostModel());
    } catch {
      // The wallet does not offer proving; fall back to a prover server below.
    }
  }
  const uri = config.proverServerUri ?? import.meta.env.VITE_PROOF_SERVER_URI ?? 'http://localhost:6300';
  return httpClientProofProvider(uri, zkConfigProvider);
}

const potIdBytes = (address: string): Uint8Array => fromHex(address).slice(0, 32);

/** The seat this secret and payout wallet actually hold on-chain, if any. */
function findSeat(l: Ledger, sk: Uint8Array, payout: Uint8Array, potId: Uint8Array): bigint | null {
  for (let s = 0n; s < l.memberCount; s++) {
    if (l.members.findPathForLeaf(pureCircuits.memberLeaf(sk, s, payout, potId)) !== undefined) return s;
  }
  return null;
}

const compiledContract = () =>
  CompiledContract.make('nightpot', Contract as any).pipe(
    (CompiledContract.withWitnesses as any)(witnesses),
    (CompiledContract.withCompiledFileAssets as any)(window.location.origin),
  );

type Providers = Awaited<ReturnType<typeof buildProviders>>;

async function buildProviders(api: ConnectedAPI) {
  const config = await api.getConfiguration();
  setNetworkId(config.networkId as Parameters<typeof setNetworkId>[0]);
  const shielded = await api.getShieldedAddresses();
  const zkConfigProvider = new FetchZkConfigProvider<string>(window.location.origin, fetch.bind(window));
  const proofProvider = await createProofProvider(api, zkConfigProvider, config as { proverServerUri?: string });

  return {
    privateStateProvider: inMemoryPrivateStateProvider<string, NightPotPrivateState>(),
    zkConfigProvider,
    proofProvider,
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri, browserWebSocket),
    walletProvider: {
      getCoinPublicKey: () => shielded.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey,
      balanceTx: async (tx: any): Promise<FinalizedTransaction> => {
        const balanced = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>('signature', 'proof', 'binding', fromHex(balanced.tx));
      },
    },
    midnightProvider: {
      submitTx: async (tx: FinalizedTransaction) => {
        await api.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      },
    },
  };
}

/** Read-only indexer access before a wallet is connected, created once. */
let readOnlyIndexer: ReturnType<typeof indexerPublicDataProvider> | null = null;
const getReadOnlyIndexer = () =>
  (readOnlyIndexer ??= indexerPublicDataProvider(INDEXER_URI, INDEXER_WS_URI, browserWebSocket));

export function useNightPot(initialAddress: string | null) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [availability, setAvailability] = useState<WalletAvailability>('checking');
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [connectedWallet, setConnectedWallet] = useState<WalletOption | null>(null);
  const [detectRun, setDetectRun] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const [address, setAddress] = useState<string | null>(initialAddress);
  const [pot, setPot] = useState<PotView | null>(null);
  const [potError, setPotError] = useState<string | null>(null);
  const [loadingPot, setLoadingPot] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [legacySeat, setLegacySeat] = useState(false);

  const [action, setAction] = useState<ActionState>({ name: null, status: 'idle', message: null, txId: null });

  const apiRef = useRef<ConnectedAPI | null>(null);
  /** Unshielded address of the connected wallet: seats are stored under it and payouts go to it. */
  const walletRef = useRef<string | null>(null);
  /** One provider set per wallet connection, reused by reads and every transaction. */
  const providersRef = useRef<{ api: ConnectedAPI; providers: Promise<Providers> } | null>(null);
  /** Only the latest pot read may update the view; older, slower responses are dropped. */
  const readSeqRef = useRef(0);
  const autoConnectTried = useRef(false);

  const getProviders = useCallback((api: ConnectedAPI): Promise<Providers> => {
    if (providersRef.current?.api !== api) {
      const providers = buildProviders(api);
      providersRef.current = { api, providers };
      providers.catch(() => {
        if (providersRef.current?.providers === providers) providersRef.current = null;
      });
    }
    return providersRef.current!.providers;
  }, []);

  // Detect wallets as soon as the page loads, and again whenever the member asks us to re-check.
  // Keep polling briefly after the first wallet appears, since several extensions may inject.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let seenAt: number | null = null;
    let timer: number | undefined;
    setAvailability('checking');

    const check = () => {
      if (cancelled) return;
      const found = listWallets();
      if (found.length > 0 && seenAt === null) seenAt = attempt;
      attempt += 1;
      const settled = seenAt !== null && attempt - seenAt >= DETECT_SETTLE_ATTEMPTS;
      if (settled || attempt >= DETECT_ATTEMPTS) {
        setWallets(found);
        setAvailability(found.length === 0 ? 'missing' : found.some((w) => w.compatible) ? 'available' : 'outdated');
        return;
      }
      timer = window.setTimeout(check, DETECT_INTERVAL_MS);
    };

    check();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [detectRun]);

  const recheckWallets = useCallback(() => {
    setWalletError(null);
    setDetectRun((n) => n + 1);
  }, []);

  /** The connected wallet's tNIGHT balance, in the smallest unit. */
  const refreshBalance = useCallback(async () => {
    const api = apiRef.current;
    if (!api) {
      setTokenBalance(null);
      return;
    }
    try {
      const balances = await api.getUnshieldedBalances();
      setTokenBalance(balances[NIGHT_BALANCE_KEY] ?? 0n);
    } catch {
      setTokenBalance(null);
    }
  }, []);

  const readPot = useCallback(
    async (target: string | null = address) => {
      if (!target) return;
      const seq = ++readSeqRef.current;
      setLoadingPot(true);
      setPotError(null);
      try {
        const api = apiRef.current;
        const indexer = api ? (await getProviders(api)).publicDataProvider : getReadOnlyIndexer();
        const state = await indexer.queryContractState(target);
        if (seq !== readSeqRef.current) return;
        if (!state) {
          setPot(null);
          setPotError(`No pot found at that address on ${NETWORK_ID}.`);
          return;
        }
        const l = ledger(state.data);
        const wallet = walletRef.current;
        let m = loadMembership(target, wallet);
        setLegacySeat(!m && !!wallet && loadLegacyMembership(target) !== null);
        let me: MySeat | null = null;
        if (m && wallet) {
          const sk = hexToBytes(m.secretKeyHex);
          const payout = userAddressBytes(wallet, NETWORK_ID);
          const potId = potIdBytes(target);
          let slot = BigInt(m.slot);
          let seated = l.members.findPathForLeaf(pureCircuits.memberLeaf(sk, slot, payout, potId)) !== undefined;
          if (!seated) {
            // Self-heal: if another join landed first, this seat may sit at a different index.
            const actual = findSeat(l, sk, payout, potId);
            if (actual !== null) {
              slot = actual;
              seated = true;
              m = { ...m, slot: actual.toString(), confirmed: true, failed: false };
              saveMembership(target, wallet, m);
            }
          } else if (!m.confirmed) {
            m = { ...m, confirmed: true, failed: false };
            saveMembership(target, wallet, m);
          }
          me = {
            slot,
            confirmed: m.confirmed,
            seated,
            paidThisRound: seated && l.contributions.member(pureCircuits.contributionNullifier(sk, slot, l.round, potId)),
            myTurn: seated && l.phase === Phase.active && slot === l.round,
            claimed: l.payouts.member(pureCircuits.payoutNullifier(sk, slot, potId)),
            retryable: !seated && (m.failed === true || Date.now() - (m.savedAt ?? 0) > 120_000),
          };
        }
        const view: PotView = {
          address: target,
          phase: phaseName(l.phase),
          maxMembers: l.maxMembers,
          contribution: l.contribution,
          memberCount: l.memberCount,
          round: l.round,
          paidThisRound: l.paidThisRound,
          potValue: l.potBalance,
          joinDeadline: l.joinDeadline,
          roundLength: l.roundLength,
          // Same formula as roundDeadline() in the contract.
          roundDue: l.phase === Phase.active ? l.joinDeadline + (l.round + 1n) * l.roundLength : null,
          missedPayments: l.missedPayments,
          skippedRounds: l.skippedRounds,
          me,
          details: null,
        };
        const local = loadDetails(target);
        if (local) {
          const expected = bytesToHex(await commitDetails(local));
          view.details = { ...local, verified: expected === bytesToHex(l.details) };
        }
        if (seq !== readSeqRef.current) return;
        setPot(view);
        void refreshBalance();
      } catch (error) {
        if (seq !== readSeqRef.current) return;
        setPot(null);
        setPotError(describeError(error));
      } finally {
        if (seq === readSeqRef.current) setLoadingPot(false);
      }
    },
    [address, refreshBalance, getProviders],
  );

  useEffect(() => {
    void readPot(address);
  }, [address, readPot]);

  // Keep the pot view current on its own; members should not need a refresh button.
  useEffect(() => {
    if (!address) return;
    const id = window.setInterval(() => void readPot(address), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [address, readPot]);

  const connect = useCallback(
    async (walletId?: string) => {
      setWalletError(null);
      setStatus('connecting');
      try {
        const options = listWallets();
        const preferred = walletId ?? readWalletPref() ?? undefined;
        const choice =
          options.find((w) => w.id === preferred) ??
          (options.filter((w) => w.compatible).length === 1 ? options.find((w) => w.compatible) : undefined);
        if (options.length === 0) {
          setAvailability('missing');
          throw new Error('No Midnight wallet was found in this browser, or it has not loaded yet.');
        }
        if (!choice) throw new Error('Choose which wallet to connect.');
        if (!choice.compatible) {
          throw new Error(
            `${choice.name} speaks DApp Connector API ${choice.apiVersion}; NightPot needs ${REQUIRED_CONNECTOR_MAJOR}x. Update the wallet and reload.`,
          );
        }
        const initial = getInitialApi(choice.id);
        if (!initial) throw new Error(`${choice.name} is no longer available. Reload the page.`);

        // This is the call that makes the wallet show its approval prompt.
        const api = await initial.connect(NETWORK_ID);
        const connection = await api.getConnectionStatus();
        if (connection.status !== 'connected') {
          throw new Error(`${choice.name} reports it is not connected. Approve the connection in the wallet.`);
        }
        if (connection.networkId !== NETWORK_ID) {
          throw new Error(`${choice.name} is on ${connection.networkId}. Switch it to ${NETWORK_ID} and connect again.`);
        }
        setNetworkId(connection.networkId as Parameters<typeof setNetworkId>[0]);
        const { unshieldedAddress } = await api.getUnshieldedAddress();
        apiRef.current = api;
        walletRef.current = unshieldedAddress;
        providersRef.current = null;
        setConnectedWallet(choice);
        setWalletAddress(unshieldedAddress);
        setStatus('connected');
        writeWalletPref(choice.id);
        void readPot();
      } catch (error) {
        apiRef.current = null;
        walletRef.current = null;
        providersRef.current = null;
        setConnectedWallet(null);
        setWalletAddress(null);
        setStatus('disconnected');
        const code = (error as { code?: string } | undefined)?.code;
        if (code === 'Rejected' || code === 'PermissionRejected') writeWalletPref(null);
        setWalletError(describeError(error));
      }
    },
    [readPot],
  );

  // Returning members are reconnected to the wallet they used last, once it is detected.
  useEffect(() => {
    if (availability !== 'available' || status !== 'disconnected' || autoConnectTried.current) return;
    autoConnectTried.current = true;
    const saved = readWalletPref();
    if (saved && wallets.some((w) => w.id === saved && w.compatible)) void connect(saved);
  }, [availability, status, wallets, connect]);

  const disconnect = useCallback(() => {
    apiRef.current = null;
    walletRef.current = null;
    providersRef.current = null;
    writeWalletPref(null);
    setConnectedWallet(null);
    setWalletAddress(null);
    setStatus('disconnected');
    setTokenBalance(null);
    setLegacySeat(false);
    // A seat belongs to a wallet; with none connected, show none.
    setPot((current) => (current ? { ...current, me: null } : current));
  }, []);

  const openPot = useCallback(
    async (api: ConnectedAPI, target: string, privateState: NightPotPrivateState): Promise<any> =>
      findDeployedContract((await getProviders(api)) as any, {
        compiledContract: compiledContract() as any,
        contractAddress: target,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: privateState,
      }),
    [getProviders],
  );

  /** Private state for calls that need no seat (skip, cancel). */
  const anyState = useCallback((target: string): NightPotPrivateState => {
    const wallet = walletRef.current!;
    const m = loadMembership(target, wallet);
    const payout = userAddressBytes(wallet, NETWORK_ID);
    return m
      ? createNightPotPrivateState(hexToBytes(m.secretKeyHex), payout, BigInt(m.slot))
      : createNightPotPrivateState(randomBytes32(), payout);
  }, []);

  /**
   * Run one wallet action with a DUST check, consistent status and errors, one
   * retry when another member's transaction changed the pot first, and a refresh.
   */
  const run = useCallback(
    async (name: ActionName, fn: (api: ConnectedAPI) => Promise<{ txId?: string; message: string }>) => {
      const api = apiRef.current;
      if (!api || !walletRef.current) {
        setAction({ name, status: 'error', message: 'Connect a wallet first.', txId: null });
        return;
      }
      // Every transaction pays its fee in DUST. Check first, so nothing fails halfway through.
      try {
        const dust = await api.getDustBalance();
        if (BigInt(dust.balance) === 0n) {
          setAction({
            name,
            status: 'error',
            message: 'Your wallet has no DUST for fees yet. Turn on DUST generation in your wallet, wait a few minutes, then try again.',
            txId: null,
          });
          return;
        }
      } catch {
        // Wallets that cannot report DUST: let the transaction itself decide.
      }
      setAction({ name, status: 'working', message: null, txId: null });
      try {
        let result: { txId?: string; message: string };
        try {
          result = await fn(api);
        } catch (error) {
          if (!isStateConflict(error)) throw error;
          // Built against state another member changed first: refresh and try once more.
          await readPot();
          result = await fn(api);
        }
        setAction({ name, status: 'done', message: result.message, txId: result.txId ?? null });
      } catch (error) {
        setAction({ name, status: 'error', message: describeError(error), txId: null });
      } finally {
        void readPot();
      }
    },
    [readPot],
  );

  /** Take the next free seat with `sk`, bound to the connected wallet, then record the seat actually taken. */
  const takeSeat = useCallback(
    async (api: ConnectedAPI, target: string, sk: Uint8Array): Promise<{ txId: string; slot: bigint }> => {
      const wallet = walletRef.current!;
      const payout = userAddressBytes(wallet, NETWORK_ID);
      const providers = await getProviders(api);
      const before = await providers.publicDataProvider.queryContractState(target);
      if (!before) throw new Error('Pot not found.');
      const guess = ledger(before.data).memberCount;
      const seat: Membership = { secretKeyHex: bytesToHex(sk), slot: guess.toString(), confirmed: false, savedAt: Date.now() };
      // Save before submitting, so a slow confirmation never loses the secret.
      saveMembership(target, wallet, seat);
      let tx: any;
      try {
        const deployed = await openPot(api, target, createNightPotPrivateState(sk, payout, guess));
        tx = await deployed.callTx.join();
      } catch (error) {
        saveMembership(target, wallet, { ...seat, failed: true });
        throw error;
      }
      // The join proved against the ledger it read; confirm which seat that was.
      const after = await providers.publicDataProvider.queryContractState(target);
      const actual = after ? findSeat(ledger(after.data), sk, payout, potIdBytes(target)) : null;
      const slot = actual ?? guess;
      saveMembership(target, wallet, { ...seat, slot: slot.toString(), confirmed: true, failed: false });
      return { txId: tx.public.txId, slot };
    },
    [getProviders, openPot],
  );

  const createPot = useCallback(
    (input: CreatePotInput) =>
      run('create', async (api) => {
        // The name and goal stay off-chain; only their salted commitment is deployed.
        const details = newDetails(input.name, input.goal);
        const commitment = await commitDetails(details);
        const joinBy = BigInt(Math.floor(Date.now() / 1000) + Math.round(input.joinWithinSeconds));
        const wallet = walletRef.current!;
        const deployed: any = await deployContract((await getProviders(api)) as any, {
          compiledContract: compiledContract() as any,
          args: [BigInt(input.size), input.contribution, joinBy, BigInt(Math.round(input.roundSeconds)), commitment],
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState: createNightPotPrivateState(randomBytes32(), userAddressBytes(wallet, NETWORK_ID)),
        });
        const created: string = deployed.deployTxData.public.contractAddress;
        saveDetails(created, details);
        setAddress(created);

        // The creator takes seat 1 straight away, as a second transaction.
        try {
          const { txId } = await takeSeat(api, created, randomBytes32());
          return { txId, message: `${details.name} is live and you hold seat 1. Copy the invite link below for your members.` };
        } catch (error) {
          return {
            txId: deployed.deployTxData.public.txId,
            message: `${details.name} is live, but taking seat 1 failed (${describeError(error)}). Use Take a seat to try again.`,
          };
        }
      }),
    [run, getProviders, takeSeat],
  );

  const join = useCallback(
    () =>
      run('join', async (api) => {
        if (!address) throw new Error('Open a pot first.');
        const existing = loadMembership(address, walletRef.current);
        const sk = existing ? hexToBytes(existing.secretKeyHex) : randomBytes32();
        const { txId, slot } = await takeSeat(api, address, sk);
        return { txId, message: `You hold seat ${Number(slot) + 1}. Payouts for it go to this wallet.` };
      }),
    [run, address, takeSeat],
  );

  const contribute = useCallback(
    () =>
      run('contribute', async (api) => {
        if (!address || !pot) throw new Error('Open a pot first.');
        const wallet = walletRef.current!;
        const m = loadMembership(address, wallet);
        if (!m) throw new Error('This wallet does not hold a seat in this pot on this device.');
        const deployed = await openPot(
          api,
          address,
          createNightPotPrivateState(hexToBytes(m.secretKeyHex), userAddressBytes(wallet, NETWORK_ID), BigInt(m.slot)),
        );
        const tx = await deployed.callTx.contribute();
        return { txId: tx.public.txId, message: `Paid ${formatNight(pot.contribution)} tNIGHT into round ${Number(pot.round) + 1}.` };
      }),
    [run, address, pot, openPot],
  );

  const claimPayout = useCallback(
    () =>
      run('claim', async (api) => {
        if (!address || !pot) throw new Error('Open a pot first.');
        const wallet = walletRef.current!;
        const m = loadMembership(address, wallet);
        if (!m) throw new Error('This wallet does not hold a seat in this pot on this device.');
        const amount = pot.potValue;
        const deployed = await openPot(
          api,
          address,
          createNightPotPrivateState(hexToBytes(m.secretKeyHex), userAddressBytes(wallet, NETWORK_ID), BigInt(m.slot)),
        );
        // The contract sends the pot to the address bound to this seat at join, never to one chosen now.
        const tx = await deployed.callTx.claimPayout();
        return { txId: tx.public.txId, message: `${formatNight(amount)} tNIGHT from round ${Number(pot.round) + 1} was sent to your wallet.` };
      }),
    [run, address, pot, openPot],
  );

  const skipRound = useCallback(
    () =>
      run('skip', async (api) => {
        if (!address || !pot) throw new Error('Open a pot first.');
        const deployed = await openPot(api, address, anyState(address));
        const tx = await deployed.callTx.skipRound();
        return { txId: tx.public.txId, message: `Round ${Number(pot.round) + 1} was skipped and the pot moved on.` };
      }),
    [run, address, pot, openPot, anyState],
  );

  const cancelPot = useCallback(
    () =>
      run('cancel', async (api) => {
        if (!address) throw new Error('Open a pot first.');
        const deployed = await openPot(api, address, anyState(address));
        const tx = await deployed.callTx.cancel();
        return { txId: tx.public.txId, message: 'The pot was cancelled. No money was held.' };
      }),
    [run, address, openPot, anyState],
  );

  /** Link a seat saved before wallet linking to the connected wallet. */
  const attachLegacySeat = useCallback(() => {
    if (!address || !walletRef.current) return;
    const legacy = loadLegacyMembership(address);
    if (!legacy) return;
    saveMembership(address, walletRef.current, legacy);
    clearLegacyMembership(address);
    void readPot();
  }, [address, readPot]);

  return {
    status,
    availability,
    wallets,
    connectedWallet,
    recheckWallets,
    walletAddress,
    walletError,
    legacySeat,
    attachLegacySeat,
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
    join,
    contribute,
    claimPayout,
    skipRound,
    cancelPot,
  };
}
