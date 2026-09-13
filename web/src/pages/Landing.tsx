import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  Check,
  GithubLogo,
  HandCoins,
  Minus,
  PersonSimpleRun,
  Megaphone,
  Vault,
  Clock,
} from '@phosphor-icons/react';

import { GITHUB_URL, MIDNIGHT_URL } from '../config';
import { Reveal } from '../components/Reveal';
import { RoundBoard } from '../components/RoundBoard';

const primaryCta =
  'inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-ink transition active:scale-[0.98] hover:brightness-105';
const secondaryCta =
  'inline-flex items-center justify-center gap-2 rounded-full border border-line px-6 py-3 text-sm font-semibold text-ink transition active:scale-[0.98] hover:bg-raised';

function Nav() {
  return (
    <header
      className="sticky z-40 border-b border-line/70 bg-bg/85 backdrop-blur"
      style={{ top: 'env(safe-area-inset-top, 0px)' }}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <HandCoins size={24} weight="duotone" className="text-accent" />
          NightPot
        </Link>
        <div className="hidden items-center gap-8 text-sm text-muted md:flex">
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#privacy" className="hover:text-ink">Privacy</a>
          <a href="#roadmap" className="hover:text-ink">Roadmap</a>
          <a href={GITHUB_URL} className="hover:text-ink">GitHub</a>
        </div>
        <Link to="/app" className={`${primaryCta} px-5 py-2`}>
          Open app
        </Link>
      </nav>
    </header>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  const enter = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-12 sm:px-6 md:pt-20 lg:grid-cols-[1.1fr_0.9fr]">
      <div>
        <motion.p {...enter(0)} className="text-sm font-medium text-accent">
          Ajo, esusu, chama, tanda, susu
        </motion.p>
        <motion.h1
          {...enter(0.05)}
          className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl lg:text-6xl"
        >
          Save together.
          <br />
          Keep it between you.
        </motion.h1>
        <motion.p {...enter(0.12)} className="mt-6 max-w-[48ch] text-lg leading-relaxed text-muted">
          Rotating savings circles on Midnight. Everyone pays in, one member takes the pot, and outsiders never learn who.
        </motion.p>
        <motion.div {...enter(0.2)} className="mt-8 flex flex-wrap gap-3">
          <Link to="/app" className={primaryCta}>
            Open app <ArrowRight size={16} weight="bold" />
          </Link>
          <a href="#how" className={secondaryCta}>
            See how it works
          </a>
        </motion.div>
      </div>
      <motion.div {...enter(0.15)}>
        <RoundBoard />
      </motion.div>
    </section>
  );
}

const problems = [
  {
    icon: PersonSimpleRun,
    title: 'The early winner stops paying.',
    body: 'Once a member has taken the pot, only social pressure keeps them paying in for everyone else.',
    className: 'md:col-span-2 bg-accent-soft',
  },
  {
    icon: Vault,
    title: 'One person holds the cash.',
    body: 'The organizer collects everyone’s money every round. Sometimes they disappear with it.',
    className: 'bg-surface',
  },
  {
    icon: Megaphone,
    title: 'Everyone knows payout day.',
    body: 'Who took the pot, and who missed a payment, travels fast. Recipients become targets.',
    className: 'md:col-span-3 bg-raised',
  },
];

function Problem() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <Reveal>
        <h2 className="max-w-[20ch] text-3xl font-semibold tracking-tight md:text-4xl">
          Savings circles run on trust. Trust breaks.
        </h2>
      </Reveal>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {problems.map(({ icon: Icon, title, body, className }, i) => (
          <Reveal key={title} delay={i * 0.06} className={`rounded-2xl border border-line p-6 sm:p-8 ${className}`}>
            <Icon size={28} weight="duotone" className="text-accent" />
            <h3 className="mt-5 text-xl font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 max-w-[55ch] text-muted">{body}</p>
          </Reveal>
        ))}
      </div>
      <Reveal>
        <p className="mt-8 max-w-[65ch] text-muted">
          Moving circles onto a public blockchain fixes the cash box but makes the exposure permanent. NightPot keeps the
          guarantees and removes the audience.
        </p>
      </Reveal>
    </section>
  );
}

const steps = [
  {
    verb: 'Join',
    body: 'Your device creates a secret and adds a sealed seat to the pot. The chain records that a seat was taken, not by whom.',
    circuit: 'join()',
  },
  {
    verb: 'Pay in',
    body: 'Each round you prove you hold a seat and pay the fixed amount in shielded tokens. A one-time tag blocks double payments without naming you.',
    circuit: 'contribute(coin)',
  },
  {
    verb: 'Take the pot',
    body: 'When everyone has paid, the member whose turn it is proves it and pulls the whole pot to their own shielded key.',
    circuit: 'claimPayout()',
  },
  {
    verb: 'Keep moving',
    body: 'Every round has a due date. After it, the recipient takes what was paid and the missed payments are counted, never named. An unclaimed round rolls forward.',
    circuit: 'skipRound()',
  },
];

function HowItWorks() {
  return (
    <section id="how" className="border-y border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <Reveal>
          <p className="text-sm font-medium text-accent">How it works</p>
          <h2 className="mt-3 max-w-[22ch] text-3xl font-semibold tracking-tight md:text-4xl">
            Every move is proven in zero knowledge.
          </h2>
        </Reveal>
        <ol className="mt-12 grid gap-10">
          {steps.map((s, i) => (
            <Reveal key={s.verb} delay={i * 0.08}>
              <li className="grid gap-3 md:grid-cols-[14rem_1fr_auto] md:items-baseline md:gap-10">
                <h3 className="text-2xl font-semibold tracking-tight">{s.verb}</h3>
                <p className="max-w-[60ch] text-muted">{s.body}</p>
                <code className="w-fit rounded-full bg-raised px-3 py-1 font-mono text-sm">{s.circuit}</code>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

const publicFacts = [
  'Pot size and the contribution amount',
  'How many seats are filled',
  'The current round and how many members have paid',
  'One-time tags for each payment and payout',
  'How many payments were missed, never whose',
];
const privateFacts = [
  'Your member secret',
  'Which seat, and so which turn, is yours',
  'The proof that you belong to the pot',
  'That any two payments came from the same person',
];

function Privacy() {
  return (
    <section id="privacy" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <Reveal>
        <h2 className="max-w-[24ch] text-3xl font-semibold tracking-tight md:text-4xl">
          What the chain sees, and what stays on your device.
        </h2>
      </Reveal>
      <div className="mt-10 grid overflow-hidden rounded-2xl border border-line md:grid-cols-2">
        <Reveal className="bg-surface p-6 sm:p-8">
          <h3 className="text-lg font-semibold">Public on Midnight</h3>
          <ul className="mt-5 grid gap-3">
            {publicFacts.map((f) => (
              <li key={f} className="flex gap-3 text-muted">
                <Minus size={18} className="mt-1 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.08} className="border-t border-line bg-accent-soft p-6 sm:p-8 md:border-l md:border-t-0">
          <h3 className="text-lg font-semibold">Private to each member</h3>
          <ul className="mt-5 grid gap-3">
            {privateFacts.map((f) => (
              <li key={f} className="flex gap-3">
                <Check size={18} weight="bold" className="mt-1 shrink-0 text-accent" />
                {f}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
      <Reveal>
        <p className="mt-6 max-w-[70ch] text-sm text-muted">
          Honest limits: every member pays the same amount, so amounts reveal nothing, but the pot balance itself is public.
          In very small pots, timing can still hint at who paid.
        </p>
      </Reveal>
    </section>
  );
}

type Cell = 'yes' | 'no' | 'partly' | 'planned';
const rows: { feature: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  { feature: 'Members take turns receiving the pot', cells: ['yes', 'no', 'yes', 'yes'] },
  { feature: 'Hides who pays in and who gets paid', cells: ['yes', 'partly', 'partly', 'no'] },
  { feature: 'Contributions move as shielded tokens', cells: ['yes', 'no', 'no', 'no'] },
  { feature: 'Keeps rotating when a member stops paying', cells: ['yes', 'no', 'no', 'partly'] },
  { feature: 'Private pools for group purchases and investments', cells: ['planned', 'no', 'no', 'no'] },
];
const columns = ['NightPot', 'HushPot', 'Sharibo', 'Public on-chain circles'];

function CellMark({ value }: { value: Cell }) {
  if (value === 'yes') return <Check size={20} weight="bold" className="text-accent" aria-label="Yes" />;
  if (value === 'no') return <Minus size={20} className="text-muted" aria-label="No" />;
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted">
      {value === 'planned' && <Clock size={16} />}
      {value === 'planned' ? 'Planned' : 'Partly'}
    </span>
  );
}

function Comparison() {
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <Reveal>
          <h2 className="max-w-[26ch] text-3xl font-semibold tracking-tight md:text-4xl">
            Other savings pots solve part of the problem.
          </h2>
        </Reveal>
        <Reveal>
          <div className="mt-10 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[640px] text-left">
              <thead className="bg-raised text-sm">
                <tr>
                  <th className="p-4 font-medium text-muted">Feature</th>
                  {columns.map((c, i) => (
                    <th key={c} className={`p-4 font-semibold ${i === 0 ? 'text-accent' : ''}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.feature} className="border-t border-line">
                    <td className="p-4">{r.feature}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} className="p-4">
                        <CellMark value={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-muted">
            Based on each project's public documentation, September 2026. HushPot is a one-time private pot on Midnight;
            Sharibo is a zero-knowledge circle on Stellar with public deposits.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const contributeExcerpt = `export circuit contribute(coin: ShieldedCoinInfo): [] {
  assert(phase == Phase.active, "NightPot: pot is not active");
  const sk = memberSecret();              // never leaves the device
  proveMembership(sk, memberSlot());      // Merkle proof, root checked on-chain

  const nul = contributionNullifier(sk, round, kernel.self().bytes);
  assert(!contributions.member(disclose(nul)), "NightPot: already contributed this round");
  assert(disclose(coin.value == contribution as Uint<128>), "NightPot: wrong contribution amount");

  contributions.insert(disclose(nul));
  receiveShielded(disclose(coin));        // the pot holds shielded tokens
  ...
}`;

const pieces = [
  { name: 'Sealed seats', detail: 'Members are hidden leaves in a HistoricMerkleTree, proven with merkleTreePathRoot.' },
  { name: 'One-time tags', detail: 'Domain-separated nullifiers per pot and round stop double payments and payouts.' },
  { name: 'Shielded pot', detail: 'receiveShielded and sendShielded move the money; payouts are pulled to the winner’s own key.' },
  { name: 'Your wallet', detail: 'Lace proves and signs in the browser through the Midnight DApp Connector.' },
];

function Architecture() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <Reveal>
        <p className="text-sm font-medium text-accent">Built on Midnight</p>
        <h2 className="mt-3 max-w-[24ch] text-3xl font-semibold tracking-tight md:text-4xl">
          Privacy is enforced by the contract, not promised by us.
        </h2>
      </Reveal>
      <div className="mt-10 grid gap-8 lg:grid-cols-[1.25fr_1fr]">
        <Reveal>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <pre className="p-6 font-mono text-[13px] leading-relaxed">
              <code>{contributeExcerpt}</code>
            </pre>
          </div>
        </Reveal>
        <div className="grid content-start gap-6">
          {pieces.map((p, i) => (
            <Reveal key={p.name} delay={i * 0.06}>
              <h3 className="font-semibold">{p.name}</h3>
              <p className="mt-1 text-muted">{p.detail}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const waves = [
  {
    wave: 'Wave 1',
    dates: 'Aug 27 to Sep 16',
    status: 'Now',
    items: [
      'Private pot contract with anonymous seats',
      'Shielded contributions and pull payouts',
      'Round deadlines so no one can freeze a pot',
      'Lace app on Preprod',
    ],
  },
  {
    wave: 'Wave 2',
    dates: 'Sep 27 to Oct 17',
    status: 'Next',
    items: ['Fair random payout order', 'Pooled collateral with private refunds', 'Pot invites and discovery'],
  },
  {
    wave: 'Wave 3',
    dates: 'Oct 27 to Nov 16',
    status: 'Later',
    items: ['Private group-purchasing pools', 'Co-investment in fixed-size units', 'Pilot with a real trader group'],
  },
];

function Roadmap() {
  return (
    <section id="roadmap" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Where NightPot goes next.</h2>
        </Reveal>
        <div className="mt-10 grid gap-4 lg:grid-cols-[1.3fr_1fr_1fr]">
          {waves.map((w, i) => (
            <Reveal
              key={w.wave}
              delay={i * 0.08}
              className={`rounded-2xl border p-6 sm:p-8 ${i === 0 ? 'border-accent bg-accent-soft' : 'border-line bg-bg'}`}
            >
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-xl font-semibold">{w.wave}</h3>
                <span className="text-sm text-muted">{w.status}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{w.dates}</p>
              <ul className="mt-5 grid gap-2">
                {w.items.map((it) => (
                  <li key={it} className="flex gap-2">
                    <Check size={18} className={`mt-0.5 shrink-0 ${i === 0 ? 'text-accent' : 'text-muted'}`} />
                    {it}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Start a pot on Preprod.</h2>
          <p className="mt-3 max-w-[50ch] text-muted">Bring Lace and a few friends. Test tokens are minted in the app.</p>
        </div>
        <Link to="/app" className={primaryCta}>
          Open app <ArrowRight size={16} weight="bold" />
        </Link>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 text-sm text-muted sm:px-6 md:flex-row md:items-center md:justify-between">
        <p>
          NightPot is open source under Apache-2.0. Built on{' '}
          <a href={MIDNIGHT_URL} className="underline underline-offset-4 hover:text-ink">
            Midnight
          </a>
          .
        </p>
        <a href={GITHUB_URL} className="inline-flex items-center gap-2 hover:text-ink">
          <GithubLogo size={18} /> GitHub
        </a>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Privacy />
        <Comparison />
        <Architecture />
        <Roadmap />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
