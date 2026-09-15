/** Public links used across the site. Update GITHUB_URL once the repo is public. */
export const GITHUB_URL = 'https://github.com/mr-abims/nightpot';
export const MIDNIGHT_URL = 'https://midnight.network';
export const NETWORK_ID = 'preprod' as const;

/**
 * Midnight wallets to suggest when none is installed. NightPot works with any
 * wallet that implements the Midnight DApp Connector API v4; these are the ones
 * we point people to.
 */
export const WALLET_INSTALLS = [
  { name: 'Lace', url: 'https://www.lace.io/', platforms: 'Chrome, Brave, Firefox' },
  { name: '1AM', url: 'https://1am.xyz/', platforms: 'Chrome, Firefox, iOS, Android' },
] as const;

/** Official Midnight Preprod tNIGHT faucet. */
export const PREPROD_FAUCET_URL = 'https://faucet.preprod.midnight.network';
