import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowsClockwise,
  CheckCircle,
  CircleNotch,
  Coins,
  DeviceMobile,
  Eye,
  HandCoins,
  Plus,
  SignIn,
  Wallet,
  WarningCircle,
} from '@phosphor-icons/react';

import { NETWORK_ID, useNightPot, type ActionName, type PotView } from '../hooks/useNightPot';
import { decodeBackup, encodeBackup, loadMembership, saveMembership } from '../lib/membership';
import { LACE_CHROME_URL, LACE_INSTALL_URL, PREPROD_FAUCET_URL } from '../config';

const primary =
  'inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition active:scale-[0.98] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50';
const secondary =
  'inline-flex items-center justify-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-semibold transition active:scale-[0.98] hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50';
const input =
  'w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none';

const short = (s: string, head = 10, tail = 6) => (s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

type Hook = ReturnType<typeof useNightPot>;

function Panel({ title, icon, children, tone = 'surface' }: { title: string; icon?: ReactNode; children: ReactNode; tone?: 'surface' | 'accent' }) {
  return (
    <section className={`rounded-2xl border border-line p-5 sm:p-6 ${tone === 'accent' ? 'bg-accent-soft' : 'bg-surface'}`}>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-mono tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The first thing a visitor sees until Lace is connected: it detects the
 * extension on load and walks them through installing, updating, or connecting.
 */
function WalletGate({ hook }: { hook: Hook }) {
  if (hook.status === 'connected') return null;

  const error = hook.walletError && (
    <div className="mt-4 flex gap-3 rounded-xl border border-line bg-bg p-4 text-sm" role="alert">
      <WarningCircle size={20} weight="duotone" className="shrink-0 text-accent" />
      <p className="min-w-0 break-words">{hook.walletError}</p>
    </div>
  );

  if (hook.availability === 'checking') {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8" aria-busy="true">
        <p className="flex items-center gap-3 text-muted">
          <CircleNotch size={20} className="animate-spin" />
          Looking for the Lace wallet in this browser
        </p>
      </section>
    );
  }

  if (hook.availability === 'missing') {
    return (
      <section className="rounded-2xl border border-accent bg-accent-soft p-6 sm:p-8">
        <h2 className="text-2xl font-semibold tracking-tight">Install Lace to use NightPot</h2>
        <p className="mt-3 max-w-[60ch] text-muted">
          NightPot runs in your browser and uses the Lace wallet to prove membership and pay privately. Install Lace,
          create or restore a wallet, switch it to {NETWORK_ID}, then come back to this page.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={LACE_INSTALL_URL} target="_blank" rel="noopener noreferrer" className={primary}>
            Install Lace <ArrowSquareOut size={16} weight="bold" />
          </a>
          <a href={LACE_CHROME_URL} target="_blank" rel="noopener noreferrer" className={secondary}>
            Chrome Web Store
          </a>
          <button type="button" className={secondary} onClick={hook.recheckWallet}>
            <ArrowsClockwise size={16} /> Check again
          </button>
        </div>
        <p className="mt-4 text-sm text-muted">
          Using Brave? Turn off Shields for this site so the extension can connect. You can still open a pot and read its
          public state without a wallet.
        </p>
        {error}
      </section>
    );
  }

  if (hook.availability === 'outdated') {
    return (
      <section className="rounded-2xl border border-accent bg-accent-soft p-6 sm:p-8">
        <h2 className="text-2xl font-semibold tracking-tight">Update Lace to continue</h2>
        <p className="mt-3 max-w-[60ch] text-muted">
          {hook.detectedWallet?.name ?? 'Your wallet'} reports DApp Connector API {hook.detectedWallet?.apiVersion}.
          NightPot needs version 4. Update the extension, then reload this page.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href={LACE_INSTALL_URL} target="_blank" rel="noopener noreferrer" className={primary}>
            Get the latest Lace <ArrowSquareOut size={16} weight="bold" />
          </a>
          <button type="button" className={secondary} onClick={hook.recheckWallet}>
            <ArrowsClockwise size={16} /> Check again
          </button>
        </div>
        {error}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-accent bg-accent-soft p-6 sm:p-8">
      <h2 className="text-2xl font-semibold tracking-tight">Connect Lace to take part</h2>
      <p className="mt-3 max-w-[60ch] text-muted">
        Lace will ask you to approve NightPot. Choose Always to skip this step next time. Make sure Lace is on{' '}
        {NETWORK_ID} and holds tNIGHT with DUST for fees.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className={primary} onClick={hook.connect} disabled={hook.status === 'connecting'}>
          {hook.status === 'connecting' ? <CircleNotch size={16} className="animate-spin" /> : <Wallet size={16} weight="bold" />}
          {hook.status === 'connecting' ? 'Approve in Lace' : 'Connect Lace'}
        </button>
        <a href={PREPROD_FAUCET_URL} target="_blank" rel="noopener noreferrer" className={secondary}>
          Get tNIGHT <ArrowSquareOut size={16} weight="bold" />
        </a>
      </div>
      {hook.status === 'connecting' && (
        <p className="mt-4 text-sm text-muted">Waiting for your approval. If no prompt appears, click the Lace icon in your browser toolbar.</p>
      )}
      {error}
    </section>
  );
}

function OpenOrCreate({
  onOpen,
  onCreate,
  canCreate,
  creating,
}: {
  onOpen: (address: string) => void;
  onCreate: (size: number, amount: bigint) => void;
  canCreate: boolean;
  creating: boolean;
}) {
  const [address, setAddress] = useState('');
  const [size, setSize] = useState('3');
  const [amount, setAmount] = useState('100');

  const submitOpen = (e: FormEvent) => {
    e.preventDefault();
    if (address.trim()) onOpen(address.trim());
  };
  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    onCreate(Number(size), BigInt(amount));
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Open a pot" icon={<SignIn size={20} weight="duotone" className="text-accent" />}>
        <form onSubmit={submitOpen} className="grid gap-3">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Pot address</span>
            <input className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Paste the contract address" spellCheck={false} />
          </label>
          <button type="submit" className={secondary} disabled={!address.trim()}>
            Open pot
          </button>
        </form>
      </Panel>
      <Panel title="Start a new pot" icon={<Plus size={20} weight="duotone" className="text-accent" />}>
        <form onSubmit={submitCreate} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Members</span>
              <input className={input} type="number" min={2} max={64} value={size} onChange={(e) => setSize(e.target.value)} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Each round pays</span>
              <input className={input} type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          </div>
          <button type="submit" className={primary} disabled={!canCreate || creating || Number(size) < 2 || Number(size) > 64 || Number(amount) < 1}>
            {creating ? <CircleNotch size={16} className="animate-spin" /> : null}
            {creating ? 'Creating pot' : 'Create pot'}
          </button>
          {!canCreate && <p className="text-sm text-muted">Connect Lace to create a pot.</p>}
        </form>
      </Panel>
    </div>
  );
}

function ActionButton({
  label,
  name,
  current,
  disabled,
  hint,
  onClick,
  variant = 'primary',
}: {
  label: string;
  name: ActionName;
  current: { name: ActionName | null; status: string };
  disabled: boolean;
  hint: string | null;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}) {
  const working = current.status === 'working' && current.name === name;
  const busy = current.status === 'working';
  return (
    <div className="grid gap-1.5">
      <button type="button" className={variant === 'primary' ? primary : secondary} disabled={disabled || busy} onClick={onClick}>
        {working && <CircleNotch size={16} className="animate-spin" />}
        {working ? 'Proving and submitting' : label}
      </button>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function PotActions({ pot, hook }: { pot: PotView; hook: Hook }) {
  const connected = hook.status === 'connected';
  const me = pot.me;
  const seated = !!me?.seated;
  const fullyPaid = pot.paidThisRound === pot.maxMembers;
  const balance = hook.tokenBalance;

  const joinHint = !connected
    ? 'Connect Lace first.'
    : pot.phase !== 'forming'
      ? 'This pot is full.'
      : me && !me.seated
        ? 'Your seat is waiting to be confirmed.'
        : seated
          ? 'You already hold a seat.'
          : null;
  const payHint = !connected
    ? 'Connect Lace first.'
    : pot.phase !== 'active'
      ? 'Paying in opens once every seat is filled.'
      : !seated
        ? 'Only members can pay in.'
        : me?.paidThisRound
          ? 'You have paid this round.'
          : balance !== null && balance < pot.contribution
            ? 'Mint test tokens first.'
            : null;
  const claimHint = !connected
    ? 'Connect Lace first.'
    : pot.phase !== 'active'
      ? 'No round is open.'
      : !me?.myTurn
        ? 'It is not your turn this round.'
        : !fullyPaid
          ? 'Waiting for every member to pay in.'
          : null;

  return (
    <Panel title="Your moves" icon={<HandCoins size={20} weight="duotone" className="text-accent" />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <ActionButton label="Take a seat" name="join" current={hook.action} disabled={joinHint !== null} hint={joinHint} onClick={hook.join} />
        <ActionButton
          label="Mint test tokens"
          name="mint"
          current={hook.action}
          disabled={!connected}
          hint={connected ? `Mints ${pot.contribution} of the pot token to you.` : 'Connect Lace first.'}
          onClick={hook.mintTestTokens}
          variant="secondary"
        />
        <ActionButton label="Pay in" name="contribute" current={hook.action} disabled={payHint !== null} hint={payHint} onClick={hook.contribute} />
        <ActionButton label="Take the pot" name="claim" current={hook.action} disabled={claimHint !== null} hint={claimHint} onClick={hook.claimPayout} />
      </div>

      {hook.action.status === 'done' && (
        <div className="mt-5 flex gap-3 rounded-xl bg-raised p-4 text-sm" role="status">
          <CheckCircle size={20} weight="duotone" className="shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="font-medium">{hook.action.message}</p>
            {hook.action.txId && <p className="mt-1 break-all font-mono text-xs text-muted">tx {hook.action.txId}</p>}
          </div>
        </div>
      )}
      {hook.action.status === 'error' && (
        <div className="mt-5 flex gap-3 rounded-xl border border-line bg-bg p-4 text-sm" role="alert">
          <WarningCircle size={20} weight="duotone" className="shrink-0 text-accent" />
          <p className="min-w-0 break-words">{hook.action.message}</p>
        </div>
      )}
    </Panel>
  );
}

function SeatBackup({ address, onRestored }: { address: string; onRestored: () => void }) {
  const membership = loadMembership(address);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const copy = async () => {
    if (!membership) return;
    try {
      await navigator.clipboard.writeText(encodeBackup(address, membership));
      setNote('Seat backup copied. Keep it somewhere only you can reach.');
    } catch {
      setNote('Copy failed. Select the backup text manually.');
    }
  };

  const restore = (e: FormEvent) => {
    e.preventDefault();
    try {
      const { pot, membership: restored } = decodeBackup(text);
      if (pot !== address.toLowerCase()) throw new Error('That backup is for a different pot.');
      saveMembership(address, restored);
      setText('');
      setNote('Seat restored on this device.');
      onRestored();
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="grid gap-3 text-sm">
      {membership ? (
        <button type="button" className={secondary} onClick={copy}>
          Copy seat backup
        </button>
      ) : (
        <form onSubmit={restore} className="grid gap-2">
          <label className="grid gap-2">
            <span className="font-medium">Restore a seat</span>
            <textarea className={`${input} min-h-20 font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a NightPot seat backup" spellCheck={false} />
          </label>
          <button type="submit" className={secondary} disabled={!text.trim()}>
            Restore seat
          </button>
        </form>
      )}
      {note && <p className="text-muted">{note}</p>}
    </div>
  );
}

function PotDetail({ pot, hook }: { pot: PotView; hook: Hook }) {
  const me = pot.me;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid content-start gap-4">
        <Panel title="The pot" icon={<Coins size={20} weight="duotone" className="text-accent" />}>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <p className="text-3xl font-semibold tracking-tight capitalize">{pot.phase}</p>
            {pot.phase === 'active' && (
              <p className="text-muted">
                Round {Number(pot.round) + 1} of {Number(pot.maxMembers)}
              </p>
            )}
          </div>
          <dl className="mt-4 divide-y divide-line/60">
            <Row label="Seats filled" value={`${pot.memberCount} / ${pot.maxMembers}`} />
            <Row label="Paid this round" value={`${pot.paidThisRound} / ${pot.maxMembers}`} />
            <Row label="Each round pays" value={pot.contribution.toString()} />
            <Row label="In the pot now" value={pot.potValue.toString()} />
            <Row label="Address" value={<span title={pot.address}>{short(pot.address)}</span>} />
          </dl>
        </Panel>
        <PotActions pot={pot} hook={hook} />
      </div>

      <div className="grid content-start gap-4">
        <Panel title="What the chain sees" icon={<Eye size={20} weight="duotone" className="text-muted" />}>
          <p className="text-sm text-muted">
            Seat count, round, how many have paid, the pot balance, and one-time tags. Never which seat is whose.
          </p>
        </Panel>
        <Panel title="Only on this device" tone="accent" icon={<DeviceMobile size={20} weight="duotone" className="text-accent" />}>
          {me ? (
            <dl className="divide-y divide-line/60">
              <Row label="Your seat" value={`${Number(me.slot) + 1}`} />
              <Row label="Seat confirmed" value={me.seated ? 'Yes' : 'Pending'} />
              <Row label="Paid this round" value={me.paidThisRound ? 'Yes' : 'No'} />
              <Row label="Your turn" value={me.myTurn ? 'Yes' : 'No'} />
              <Row label="Pot token balance" value={hook.tokenBalance === null ? 'Connect Lace' : hook.tokenBalance.toString()} />
            </dl>
          ) : (
            <p className="text-sm text-muted">You do not hold a seat in this pot on this device.</p>
          )}
          <div className="mt-4">
            <SeatBackup address={pot.address} onRestored={() => void hook.refresh()} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function AppPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('pot') || import.meta.env.VITE_POT_ADDRESS || null;
  const hook = useNightPot(initial);

  const open = (address: string) => {
    hook.setAddress(address);
    setParams({ pot: address });
  };

  if (hook.address && params.get('pot') !== hook.address) {
    queueMicrotask(() => setParams({ pot: hook.address! }, { replace: true }));
  }

  const headerAction =
    hook.status === 'connected' && hook.walletAddress ? (
      <div className="flex items-center gap-3">
        <span className="hidden font-mono text-xs text-muted sm:inline" title={hook.walletAddress}>
          {short(hook.walletAddress, 12, 6)}
        </span>
        <button type="button" className={secondary} onClick={hook.disconnect}>
          Disconnect
        </button>
      </div>
    ) : hook.availability === 'available' ? (
      <button type="button" className={primary} onClick={hook.connect} disabled={hook.status === 'connecting'}>
        <Wallet size={16} weight="bold" />
        {hook.status === 'connecting' ? 'Approve in Lace' : 'Connect Lace'}
      </button>
    ) : hook.availability === 'missing' ? (
      <a href={LACE_INSTALL_URL} target="_blank" rel="noopener noreferrer" className={primary}>
        Install Lace <ArrowSquareOut size={16} weight="bold" />
      </a>
    ) : null;

  return (
    <div className="min-h-[100dvh]">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
            <ArrowLeft size={16} />
            NightPot
          </Link>
          {headerAction}
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Your savings pot</h1>
            <p className="mt-2 text-muted">Running on Midnight {NETWORK_ID}. Proofs are generated by your wallet's prover.</p>
          </div>
          {hook.address && (
            <button type="button" className={secondary} onClick={() => void hook.refresh()} disabled={hook.loadingPot}>
              <ArrowsClockwise size={16} className={hook.loadingPot ? 'animate-spin' : ''} />
              Refresh
            </button>
          )}
        </div>

        <WalletGate hook={hook} />

        <OpenOrCreate
          onOpen={open}
          onCreate={hook.createPot}
          canCreate={hook.status === 'connected'}
          creating={hook.action.name === 'create' && hook.action.status === 'working'}
        />

        {hook.action.name === 'create' && hook.action.status === 'error' && (
          <div className="flex gap-3 rounded-2xl border border-line bg-surface p-4 text-sm" role="alert">
            <WarningCircle size={20} weight="duotone" className="shrink-0 text-accent" />
            <p className="break-words">{hook.action.message}</p>
          </div>
        )}

        {hook.loadingPot && !hook.pot && (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]" aria-busy="true">
            <div className="h-72 animate-pulse rounded-2xl bg-raised" />
            <div className="h-72 animate-pulse rounded-2xl bg-raised" />
          </div>
        )}
        {hook.potError && (
          <div className="flex gap-3 rounded-2xl border border-line bg-surface p-4 text-sm" role="alert">
            <WarningCircle size={20} weight="duotone" className="shrink-0 text-accent" />
            <p>{hook.potError}</p>
          </div>
        )}
        {hook.pot && <PotDetail pot={hook.pot} hook={hook} />}
        {!hook.address && !hook.loadingPot && (
          <p className="text-sm text-muted">Open a pot someone shared with you, or start a new one and share its address.</p>
        )}
      </main>
    </div>
  );
}
