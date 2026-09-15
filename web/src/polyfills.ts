/**
 * Browser globals the Midnight SDK expects from Node.
 *
 * Parts of Midnight.js (the deploy path in particular) reference the global
 * Buffer, and some bundled dependencies reference Node's `global`, without
 * importing either. This module must be the first import in main.tsx so both
 * exist before any SDK code is evaluated.
 */
import { Buffer } from 'buffer';

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer; global?: typeof globalThis };
if (!g.global) g.global = globalThis;
if (!g.Buffer) g.Buffer = Buffer;
