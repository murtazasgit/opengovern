import { NetworkId, WalletId, WalletManager, WalletProvider } from '@txnlab/use-wallet-react'
import { ReactNode } from 'react'

const isLocalnet = import.meta.env.VITE_NETWORK === 'localnet'

const wallets: any[] = [
  {
    id: WalletId.KMD,
    options: {
      baseServer: import.meta.env.VITE_KMD_SERVER || 'http://localhost',
      port: import.meta.env.VITE_KMD_PORT || 4002,
      token: import.meta.env.VITE_KMD_TOKEN || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      wallet: import.meta.env.VITE_KMD_WALLET || 'unencrypted-default-wallet',
    },
  },
  WalletId.PERA,
]

const walletManager = new WalletManager({
  wallets: isLocalnet ? wallets : [WalletId.PERA],
  defaultNetwork: isLocalnet ? NetworkId.LOCALNET : NetworkId.TESTNET,
  networks: {
    [NetworkId.LOCALNET]: {
      algod: {
        baseServer: import.meta.env.VITE_ALGOD_SERVER || 'http://localhost',
        port: import.meta.env.VITE_ALGOD_PORT || 4001,
        token: import.meta.env.VITE_ALGOD_TOKEN || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    },
    [NetworkId.TESTNET]: {
      algod: {
        baseServer: 'https://testnet-api.algonode.cloud',
        port: 443,
        token: '',
      },
    },
  },
})

export function AppWalletProvider({ children }: { children: ReactNode }) {
  return <WalletProvider manager={walletManager}>{children}</WalletProvider>
}
