/// <reference types="vite/client" />
import '@midnight-ntwrk/dapp-connector-api';

interface ImportMetaEnv {
  readonly VITE_NETWORK_ID?: string;
  readonly VITE_POT_ADDRESS?: string;
  readonly VITE_INDEXER_URI?: string;
  readonly VITE_INDEXER_WS_URI?: string;
  readonly VITE_PROOF_SERVER_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
