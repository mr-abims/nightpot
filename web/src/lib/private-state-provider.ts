/**
 * Browser private-state provider for the SDK: in memory, scoped per contract.
 *
 * The SDK only needs private state for the duration of one call, and the
 * member's secret is kept separately (see membership.ts) so the member can back
 * it up. Writes made before a contract address is known (during a deploy) go to
 * a pending bucket and move under the address once the SDK sets it.
 *
 * Adapted from the in-memory provider in the midnight-lvl2 project, itself
 * modelled on midnightntwrk/example-bboard.
 */
import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { PrivateStateId, PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

const PENDING = '__pending__';

export const inMemoryPrivateStateProvider = <PSI extends PrivateStateId, PS = unknown>(): PrivateStateProvider<
  PSI,
  PS
> => {
  const privateStates = new Map<string, Map<PSI, PS>>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  let contractAddress: string = PENDING;

  const scoped = (address: string): Map<PSI, PS> => {
    let states = privateStates.get(address);
    if (!states) {
      states = new Map<PSI, PS>();
      privateStates.set(address, states);
    }
    return states;
  };

  const unsupported = (what: string) => (): never => {
    throw new Error(`${what} is not supported by the in-memory private state provider.`);
  };

  return {
    setContractAddress(address: ContractAddress): void {
      const pending = privateStates.get(PENDING);
      if (pending && address !== PENDING) {
        const target = scoped(address);
        for (const [k, v] of pending) if (!target.has(k)) target.set(k, v);
        privateStates.delete(PENDING);
      }
      contractAddress = address;
    },
    set(key: PSI, state: PS): Promise<void> {
      scoped(contractAddress).set(key, state);
      return Promise.resolve();
    },
    get(key: PSI): Promise<PS | null> {
      return Promise.resolve(scoped(contractAddress).get(key) ?? null);
    },
    remove(key: PSI): Promise<void> {
      scoped(contractAddress).delete(key);
      return Promise.resolve();
    },
    clear(): Promise<void> {
      privateStates.delete(contractAddress);
      return Promise.resolve();
    },
    setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      signingKeys.set(address, signingKey);
      return Promise.resolve();
    },
    getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return Promise.resolve(signingKeys.get(address) ?? null);
    },
    removeSigningKey(address: ContractAddress): Promise<void> {
      signingKeys.delete(address);
      return Promise.resolve();
    },
    clearSigningKeys(): Promise<void> {
      signingKeys.clear();
      return Promise.resolve();
    },
    exportPrivateStates: unsupported('Exporting private state'),
    importPrivateStates: unsupported('Importing private state'),
    exportSigningKeys: unsupported('Exporting signing keys'),
    importSigningKeys: unsupported('Importing signing keys'),
  } as unknown as PrivateStateProvider<PSI, PS>;
};
