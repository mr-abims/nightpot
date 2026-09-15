import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowSquareOut,
  ArrowsClockwise,
  Check,
  CheckCircle,
  CircleNotch,
  Clock,
  Coins,
  Copy,
  DeviceMobile,
  Eye,
  HandCoins,
  Plus,
  SignIn,
  Wallet,
  WarningCircle,
} from '@phosphor-icons/react';

import {
  NETWORK_ID,
  useNightPot,
  type ActionName,
  type CreatePotInput,
  type PotView,
  type WalletOption,
} from '../hooks/useNightPot';
import { decodeBackup, encodeBackup, loadMembership, saveMembership } from '../lib/membership';
import { PREPROD_FAUCET_URL, WALLET_INSTALLS } from '../config';
import { formatNight, parseNight } from '../lib/night';
import {
  decodeDetailsFragment,
  encodeDetailsFragment,
  GOAL_MAX,
  NAME_MAX,
  saveDetails,
  type PotDetails,
} from '../lib/potDetails';

const primary =
  'inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition active:scale-[0.98] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50';
const secondary =
  'inline-flex items-center justify-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-semibold transition active:scale-[0.98] hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50';
const input =
  'w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none';

const short = (s: string, head = 10, tail = 6) => (s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

const formatTime = (seconds: bigint): string =>
  new Date(Number(seconds) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const formatDuration = (seconds: bigint): string => {
  const s = Number(seconds);
  if (s % 86_400 === 0) return `${s / 86_400} ${s === 86_400 ? 'day' : 'days'}`;
  if (s % 3_600 === 0) return `${s / 3_600} ${s === 3_600 ? 'hour' : 'hours'}`;
  return `${Math.round(s / 60)} min`;
};

/** Wall-clock seconds, refreshed periodically so due dates flip without a reload. */
function useNowSeconds(): bigint {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = window.setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

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

/** Copies text, falling back to a hidden textarea where the Clipboard API is blocked. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** The full pot address: click it or the button to copy, or copy a ready-to-share invite link. */
function CopyAddress({ address, details }: { address: string; details: PotDetails | null }) {
  const [copied, setCopied] = useState<'address' | 'link' | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copy = async (what: 'address' | 'link') => {
    const text = what === 'address' ? address : `${window.location.origin}/app?pot=${address}${details ? `#${encodeDetailsFragment(details)}` : ''}`;
    const ok = await copyText(text);
    setFailed(!ok);
    setCopied(ok ? what : null);
  };

  return (
    <div className="mt-4 rounded-xl border border-line bg-bg p-3">
      <p className="text-xs font-medium text-muted">Pot address</p>
      <div className="mt-1 flex items-start gap-2">
        <button
          type="button"
          onClick={() => void copy('address')}
          title="Click to copy the pot address"
          className="min-w-0 flex-1 cursor-copy break-all rounded-md text-left font-mono text-sm transition hover:text-accent"
        >
          {address}
        </button>
        <button
          type="button"
          onClick={() => void copy('address')}
          aria-label="Copy pot address"
          title="Copy pot address"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line transition hover:bg-raised active:scale-95"
        >
          {copied === 'address' ? <Check size={16} weight="bold" className="text-accent" /> : <Copy size={16} />}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <button
          type="button"
          onClick={() => void copy('link')}
          className="inline-flex items-center gap-1 font-semibold text-ink underline-offset-4 hover:underline"
        >
          {copied === 'link' ? <Check size={14} weight="bold" className="text-accent" /> : <Copy size={14} />}
          Copy invite link
        </button>
        <span role="status" aria-live="polite" className="text-muted">
          {copied === 'address'
            ? 'Address copied.'
            : copied === 'link'
              ? 'Invite link copied. Send it to your members.'
              : failed
                ? 'Copy failed. Select the address and copy it manually.'
                : ''}
        </span>
      </div>
    </div>
  );
}

/** The wallet's own icon when it provides one, otherwise a generic wallet glyph. */
function WalletIcon({ wallet, size = 24 }: { wallet: Pick<WalletOption, 'icon' | 'name'>; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!wallet.icon || broken) return <Wallet size={size} weight="duotone" className="shrink-0 text-accent" aria-hidden />;
  return (
    <img
      src={wallet.icon}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-md"
      onError={() => setBroken(true)}
    />
  );
}

function InstallLinks({ onRecheck }: { onRecheck: () => void }) {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      {WALLET_INSTALLS.map((w, i) => (
        <a
          key={w.name}
          href={w.url}
          target="_blank"
          rel="noopener noreferrer"
          className={i === 0 ? primary : secondary}
          title={w.platforms}
        >
          Get {w.name} <ArrowSquareOut size={16} weight="bold" />
        </a>
      ))}
      <button type="button" className={secondary} onClick={onRecheck}>
        <ArrowsClockwise size={16} /> Check again
      </button>
    </div>
  );
}

/**
 * The first thing a visitor sees until a wallet is connected: it lists every
 * Midnight wallet found in the browser, or walks them through installing one.
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
      <section id="wallets" className="rounded-2xl border border-line bg-surface p-6 sm:p-8" aria-busy="true">
        <p className="flex items-center gap-3 text-muted">
          <CircleNotch size={20} className="animate-spin" />
          Looking for Midnight wallets in this browser
        </p>
      </section>
    );
  }

  if (hook.availability === 'missing') {
    return (
      <section id="wallets" className="rounded-2xl border border-accent bg-accent-soft p-6 sm:p-8">
        <h2 className="text-2xl font-semibold tracking-tight">Install a Midnight wallet to use NightPot</h2>
        <p className="mt-3 max-w-[62ch] text-muted">
          NightPot works with any Midnight wallet that supports the DApp Connector. Install one, create or restore a
          wallet, switch it to {NETWORK_ID}, then come back to this page.
        </p>
        <InstallLinks onRecheck={hook.recheckWallets} />
        <p className="mt-4 text-sm text-muted">
          Using Brave? Turn off Shields for this site so the extension can connect. You can still open a pot and read its
          public state without a wallet.
        </p>
        {error}
      </section>
    );
  }

  const connecting = hook.status === 'connecting';

  return (
    <section id="wallets" className="rounded-2xl border border-accent bg-accent-soft p-6 sm:p-8">
      <h2 className="text-2xl font-semibold tracking-tight">
        {hook.availability === 'outdated' ? 'Update your wallet to continue' : 'Choose a wallet to take part'}
      </h2>
      <p className="mt-3 max-w-[62ch] text-muted">
        {hook.availability === 'outdated'
          ? 'The wallets in this browser use an older DApp Connector. NightPot needs version 4. Update the extension, then reload.'
          : `Your wallet will ask you to approve NightPot. Make sure it is on ${NETWORK_ID} and holds tNIGHT with DUST for fees.`}
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {hook.wallets.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => void hook.connect(w.id)}
              disabled={!w.compatible || connecting}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-accent active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <WalletIcon wallet={w} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{w.name}</span>
                <span className="block text-xs text-muted">
                  {w.compatible ? `DApp Connector ${w.apiVersion}` : `Needs update: API ${w.apiVersion}`}
                </span>
              </span>
              {connecting ? <CircleNotch size={18} className="animate-spin text-muted" /> : w.compatible && <span className="text-sm font-semibold text-accent">Connect</span>}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a href={PREPROD_FAUCET_URL} target="_blank" rel="noopener noreferrer" className={secondary}>
          Get tNIGHT <ArrowSquareOut size={16} weight="bold" />
        </a>
        <button type="button" className={secondary} onClick={hook.recheckWallets}>
          <ArrowsClockwise size={16} /> Check again
        </button>
      </div>
      {connecting && (
        <p className="mt-4 text-sm text-muted">Waiting for your approval. If no prompt appears, open the wallet from your browser toolbar.</p>
      )}
      {hook.availability === 'outdated' && <InstallLinks onRecheck={hook.recheckWallets} />}
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
  onCreate: (input: CreatePotInput) => void;
  canCreate: boolean;
  creating: boolean;
}) {
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [size, setSize] = useState('3');
  const [amount, setAmount] = useState('1');
  const [joinHours, setJoinHours] = useState('24');
  const [roundHours, setRoundHours] = useState('168');

  const joinSeconds = Number(joinHours) * 3600;
  const roundSeconds = Number(roundHours) * 3600;
  const valid =
    name.trim().length > 0 &&
    Number(size) >= 2 &&
    Number(size) <= 64 &&
    (parseNight(amount) ?? 0n) > 0n &&
    Number.isFinite(joinSeconds) &&
    joinSeconds >= 60 &&
    Number.isFinite(roundSeconds) &&
    roundSeconds >= 60;

  const submitOpen = (e: FormEvent) => {
    e.preventDefault();
    if (address.trim()) onOpen(address.trim());
  };
  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onCreate({ name, goal, size: Number(size), contribution: parseNight(amount)!, joinWithinSeconds: joinSeconds, roundSeconds });
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
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Pot name</span>
            <input className={input} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="For example, Market traders savings" />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Goal (optional)</span>
            <input className={input} value={goal} maxLength={GOAL_MAX} onChange={(e) => setGoal(e.target.value)} placeholder="For example, School fees for September" />
            <span className="text-xs text-muted">Only a fingerprint of the name and goal goes on-chain. Members see them through your invite link.</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Members</span>
              <input className={input} type="number" min={2} max={64} value={size} onChange={(e) => setSize(e.target.value)} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Each round pays (tNIGHT)</span>
              <input className={input} type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Seats fill within (hours)</span>
              <input className={input} type="number" min={0.02} step="any" value={joinHours} onChange={(e) => setJoinHours(e.target.value)} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Each round lasts (hours)</span>
              <input className={input} type="number" min={0.02} step="any" value={roundHours} onChange={(e) => setRoundHours(e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-muted">Short rounds such as 0.25 hours are handy for a demo. Block time is approximate, so leave a few minutes of slack.</p>
          <button type="submit" className={primary} disabled={!canCreate || creating || !valid}>
            {creating ? <CircleNotch size={16} className="animate-spin" /> : null}
            {creating ? 'Creating pot and taking seat 1' : 'Create pot'}
          </button>
          {!canCreate && <p className="text-sm text-muted">Connect a wallet to create a pot.</p>}
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

function PotActions({ pot, hook, now }: { pot: PotView; hook: Hook; now: bigint }) {
  const connected = hook.status === 'connected';
  const me = pot.me;
  const seated = !!me?.seated;
  const fullyPaid = pot.paidThisRound === pot.maxMembers;
  const balance = hook.tokenBalance;
  const joinClosed = now >= pot.joinDeadline;
  const overdue = pot.roundDue !== null && now >= pot.roundDue;
  const skipAt = pot.roundDue !== null ? pot.roundDue + pot.roundLength : null;
  const skippable = skipAt !== null && now >= skipAt;
  const needWallet = 'Connect a wallet first.';

  const joinHint = !connected
    ? needWallet
    : pot.phase !== 'forming'
      ? 'This pot is no longer taking members.'
      : joinClosed
        ? 'Joining has closed.'
        : me && !me.seated && !me.retryable
          ? 'Your seat is being confirmed. If it does not appear within two minutes, you can try again.'
          : seated
            ? 'You already hold a seat.'
            : null;
  const payHint = !connected
    ? needWallet
    : pot.phase !== 'active'
      ? 'Paying in opens once every seat is filled.'
      : !seated
        ? 'Only members can pay in.'
        : me?.paidThisRound
          ? 'You have paid this round.'
          : balance !== null && balance < pot.contribution
            ? `You need ${formatNight(pot.contribution)} tNIGHT. Get some from the faucet.`
            : null;
  const claimHint = !connected
    ? needWallet
    : pot.phase !== 'active'
      ? 'No round is open.'
      : me?.claimed
        ? 'You have already taken your pot.'
        : !me?.myTurn
        ? 'It is not your turn this round.'
        : !fullyPaid && !overdue
          ? `Waiting for every member to pay, or until ${formatTime(pot.roundDue!)}.`
          : pot.potValue === 0n
            ? 'Nothing has been paid this round yet.'
            : null;

  return (
    <Panel title="Your moves" icon={<HandCoins size={20} weight="duotone" className="text-accent" />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <ActionButton label={me?.retryable ? 'Try taking your seat again' : 'Take a seat'} name="join" current={hook.action} disabled={joinHint !== null} hint={joinHint} onClick={hook.join} />
        <ActionButton label="Pay in" name="contribute" current={hook.action} disabled={payHint !== null} hint={payHint} onClick={hook.contribute} />
        <ActionButton
          label={overdue && !fullyPaid ? 'Take what was paid' : 'Take the pot'}
          name="claim"
          current={hook.action}
          disabled={claimHint !== null}
          hint={claimHint}
          onClick={hook.claimPayout}
        />
        {pot.phase === 'active' && pot.round + 1n < pot.maxMembers && (
          <ActionButton
            label="Skip this round"
            name="skip"
            current={hook.action}
            disabled={!connected || !skippable}
            hint={
              !connected
                ? needWallet
                : skippable
                  ? 'The recipient did not claim in time. Anyone can move the pot on.'
                  : `Available from ${formatTime(skipAt!)} if the round is still unclaimed.`
            }
            onClick={hook.skipRound}
            variant="secondary"
          />
        )}
        {pot.phase === 'forming' && (
          <ActionButton
            label="Cancel this pot"
            name="cancel"
            current={hook.action}
            disabled={!connected || !joinClosed}
            hint={
              !connected
                ? needWallet
                : joinClosed
                  ? 'The seats did not fill in time. Anyone can cancel.'
                  : `Available from ${formatTime(pot.joinDeadline)} if seats are still empty.`
            }
            onClick={hook.cancelPot}
            variant="secondary"
          />
        )}
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

function SeatBackup({ address, wallet, onRestored }: { address: string; wallet: string | null; onRestored: () => void }) {
  const membership = loadMembership(address, wallet);
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
      if (!wallet) throw new Error('Connect the wallet this seat belongs to first.');
      saveMembership(address, wallet, restored);
      setText('');
      setNote('Seat restored on this device.');
      onRestored();
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="grid gap-3 text-sm">
      {!wallet ? (
        <p className="text-muted">Connect a wallet to see or restore your seat in this pot.</p>
      ) : membership ? (
        <>
          <p className="rounded-xl border border-line bg-bg p-3 text-xs">
            The backup holds your seat secret. Anyone who has it can act for this seat; payouts still only go to the
            wallet the seat was taken with. Keep it private, like a password.
          </p>
          <button type="button" className={secondary} onClick={copy}>
            Copy seat backup
          </button>
        </>
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
  const now = useNowSeconds();
  const me = pot.me;
  const overdue = pot.roundDue !== null && now >= pot.roundDue;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid content-start gap-4">
        <Panel title="The pot" icon={<Coins size={20} weight="duotone" className="text-accent" />}>
          {pot.details ? (
            <div className="mb-4">
              <p className="text-2xl font-semibold tracking-tight break-words">{pot.details.name}</p>
              {pot.details.goal && <p className="mt-1 text-muted break-words">{pot.details.goal}</p>}
              {pot.details.verified ? (
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ink">
                  <Check size={14} weight="bold" className="text-accent" /> Matches the fingerprint on-chain
                </p>
              ) : (
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ink">
                  <WarningCircle size={14} weight="bold" className="text-accent" /> This name does not match the pot. Ask the creator for a fresh invite link.
                </p>
              )}
            </div>
          ) : (
            <p className="mb-4 text-sm text-muted">This pot's name is private. Open it from the creator's invite link to see it.</p>
          )}
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <p className="text-3xl font-semibold tracking-tight capitalize">{pot.phase}</p>
            {pot.phase === 'active' && (
              <p className="text-muted">
                Round {Number(pot.round) + 1} of {Number(pot.maxMembers)}
              </p>
            )}
            {pot.phase === 'active' && overdue && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-ink">
                <Clock size={14} weight="bold" /> Round is due
              </span>
            )}
          </div>
          <CopyAddress address={pot.address} details={pot.details} />
          <dl className="mt-4 divide-y divide-line/60">
            <Row label="Seats filled" value={`${pot.memberCount} / ${pot.maxMembers}`} />
            {pot.phase === 'forming' && <Row label="Seats close" value={formatTime(pot.joinDeadline)} />}
            {pot.roundDue !== null && <Row label="This round is due" value={formatTime(pot.roundDue)} />}
            <Row label="Paid this round" value={`${pot.paidThisRound} / ${pot.maxMembers}`} />
            <Row label="Each round pays" value={`${formatNight(pot.contribution)} tNIGHT`} />
            <Row label="Round length" value={formatDuration(pot.roundLength)} />
            <Row label="In the pot now" value={`${formatNight(pot.potValue)} tNIGHT`} />
            <Row label="Missed payments" value={pot.missedPayments.toString()} />
            <Row label="Skipped rounds" value={pot.skippedRounds.toString()} />
          </dl>
        </Panel>
        <PotActions pot={pot} hook={hook} now={now} />
      </div>

      <div className="grid content-start gap-4">
        <Panel title="What the chain sees" icon={<Eye size={20} weight="duotone" className="text-muted" />}>
          <p className="text-sm text-muted">
            Seat count, schedule, round, how many have paid, the tNIGHT in the pot, missed payments, and one-time tags. In
            Wave 1 the pot uses public tNIGHT, so the wallets that pay in and the wallet each pot is sent to are visible
            too. Wave 2 moves the pot to shielded tokens.
          </p>
        </Panel>
        <Panel title="Only on this device" tone="accent" icon={<DeviceMobile size={20} weight="duotone" className="text-accent" />}>
          {me ? (
            <dl className="divide-y divide-line/60">
              <Row label="Your seat" value={`${Number(me.slot) + 1}`} />
              <Row label="Seat confirmed" value={me.seated ? 'Yes' : me.retryable ? 'Not confirmed' : 'Pending'} />
              <Row label="Paid this round" value={me.paidThisRound ? 'Yes' : 'No'} />
              <Row label="Your turn" value={me.myTurn ? 'Yes' : 'No'} />
              <Row label="Your tNIGHT" value={hook.tokenBalance === null ? 'Connect a wallet' : formatNight(hook.tokenBalance)} />
            </dl>
          ) : (
            <div className="grid gap-3 text-sm">
              <p className="text-muted">
                {hook.status === 'connected'
                  ? 'This wallet does not hold a seat in this pot on this device.'
                  : 'Connect a wallet to see your seat.'}
              </p>
              {hook.legacySeat && (
                <div className="rounded-xl border border-line bg-bg p-3">
                  <p>A seat saved on this device before seats were linked to wallets was found.</p>
                  <button type="button" className={`${secondary} mt-3`} onClick={hook.attachLegacySeat}>
                    Link it to this wallet
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="mt-4">
            <SeatBackup address={pot.address} wallet={hook.walletAddress} onRestored={() => void hook.refresh()} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function AppPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('pot') || import.meta.env.VITE_POT_ADDRESS || null;
  // An invite link carries the pot's name and goal after '#'. Keep them on this device
  // before the first read, so the pot panel can verify them against the chain.
  useState(() => {
    const fromLink = decodeDetailsFragment(window.location.hash);
    if (fromLink && initial) saveDetails(initial, fromLink);
    return null;
  });
  const hook = useNightPot(initial);

  const open = (address: string) => {
    hook.setAddress(address);
    setParams({ pot: address });
  };

  if (hook.address && params.get('pot') !== hook.address) {
    queueMicrotask(() => setParams({ pot: hook.address! }, { replace: true }));
  }

  const compatible = hook.wallets.filter((w) => w.compatible);
  const headerAction =
    hook.status === 'connected' && hook.walletAddress ? (
      <div className="flex items-center gap-3">
        {hook.connectedWallet && <WalletIcon wallet={hook.connectedWallet} size={20} />}
        <span className="hidden font-mono text-xs text-muted sm:inline" title={hook.walletAddress}>
          {short(hook.walletAddress, 12, 6)}
        </span>
        <button type="button" className={secondary} onClick={hook.disconnect}>
          Disconnect
        </button>
      </div>
    ) : hook.availability === 'available' && compatible.length === 1 ? (
      <button type="button" className={primary} onClick={() => void hook.connect(compatible[0].id)} disabled={hook.status === 'connecting'}>
        <WalletIcon wallet={compatible[0]} size={16} />
        {hook.status === 'connecting' ? `Approve in ${compatible[0].name}` : `Connect ${compatible[0].name}`}
      </button>
    ) : hook.availability === 'available' || hook.availability === 'missing' || hook.availability === 'outdated' ? (
      <a href="#wallets" className={primary}>
        <Wallet size={16} weight="bold" />
        {hook.availability === 'missing' ? 'Get a wallet' : 'Connect wallet'}
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
            <p className="mt-2 text-muted">
              Running on Midnight {NETWORK_ID}
              {hook.connectedWallet ? ` with ${hook.connectedWallet.name}` : ''}. Your secrets never leave this device.
            </p>
          </div>
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
