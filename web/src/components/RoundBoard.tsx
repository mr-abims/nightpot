import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Eye, HandCoins, LockSimple, DeviceMobile } from '@phosphor-icons/react';

const SEATS = 6;

/**
 * A live model of one pot: six sealed seats, and the turn moving around the
 * circle one round at a time. It shows the product's core idea: the round is
 * public, the person holding the seat is not.
 */
export function RoundBoard() {
  const reduce = useReducedMotion();
  const [round, setRound] = useState(2);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setRound((r) => (r + 1) % SEATS), 2600);
    return () => window.clearInterval(id);
  }, [reduce]);

  return (
    <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <div className="relative mx-auto aspect-square w-full max-w-[320px]">
        {Array.from({ length: SEATS }, (_, i) => {
          const angle = (i / SEATS) * 2 * Math.PI - Math.PI / 2;
          const x = 50 + 40 * Math.cos(angle);
          const y = 50 + 40 * Math.sin(angle);
          const active = i === round;
          return (
            <motion.div
              key={i}
              className={`absolute flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border ${
                active ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-raised text-muted'
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
              animate={reduce ? undefined : { scale: active ? 1.12 : 1 }}
              transition={{ type: 'spring', stiffness: 160, damping: 18 }}
              aria-hidden
            >
              {active ? <HandCoins size={26} weight="duotone" /> : <LockSimple size={22} weight="duotone" />}
            </motion.div>
          );
        })}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-sm text-muted">Round</span>
          <span className="font-mono text-4xl font-semibold tabular-nums">
            {round + 1}
            <span className="text-muted">/{SEATS}</span>
          </span>
          <span className="mt-1 text-sm text-muted">everyone paid in</span>
        </div>
      </div>

      <dl className="mt-6 grid gap-3 text-sm">
        <div className="flex items-start gap-3 rounded-xl bg-raised px-4 py-3">
          <Eye size={20} weight="duotone" className="mt-0.5 shrink-0 text-muted" />
          <div>
            <dt className="font-medium">The chain sees</dt>
            <dd className="text-muted">Round {round + 1} was paid out to one of six sealed seats.</dd>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl bg-accent-soft px-4 py-3">
          <DeviceMobile size={20} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
          <div>
            <dt className="font-medium">Only the winner's phone knows</dt>
            <dd className="text-muted">That seat was theirs.</dd>
          </div>
        </div>
      </dl>
    </div>
  );
}
