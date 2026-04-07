import { useWallet } from '@txnlab/use-wallet-react'

export function ConnectWallet() {
  const { wallets, activeAccount, activeWallet } = useWallet()
  const isLocalnet = import.meta.env.VITE_NETWORK === 'localnet'

  const shorten = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const networkLabel = activeWallet?.id?.toLowerCase().includes('kmd') ? 'LOCAL' : isLocalnet ? 'LOCAL' : 'TESTNET'

  if (activeAccount) {
    return (
      <div className="flex items-center gap-3">
        <span className="border-2 border-black bg-white px-2 py-1 text-[10px] font-bold font-mono tracking-widest uppercase shadow-[2px_2px_0px_#000]">
          {networkLabel}
        </span>

        <select
          value={activeAccount.address}
          onChange={(e) => {
            const found = activeWallet?.accounts.find((a) => a.address === e.target.value)
            if (found) activeWallet?.setActiveAccount(found.address)
          }}
          className="border-2 border-black bg-[#f4f4f4] text-xs font-mono font-bold px-3 py-2 cursor-pointer outline-none uppercase shadow-[4px_4px_0px_#000] focus:shadow-none hover:translate-y-[2px] hover:translate-x-[2px] transition-all"
        >
          {activeWallet?.accounts.map((acc) => (
            <option key={acc.address} value={acc.address}>
              {shorten(acc.address)}
            </option>
          ))}
        </select>

        <button onClick={() => activeWallet?.disconnect()} className="btn-web3 bg-black text-white hover:bg-gray-800 px-4 py-2 text-xs">
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="border-2 border-black bg-white px-2 py-1 text-[10px] font-bold font-mono tracking-widest uppercase shadow-[2px_2px_0px_#000]">
        {isLocalnet ? 'LOCAL' : 'TESTNET'}
      </span>

      {wallets
        .filter((w) => (isLocalnet ? true : w.id?.toLowerCase() !== 'kmd'))
        .map((wallet) => (
          <button key={wallet.id} onClick={() => wallet.connect()} className="btn-primary-web3 text-xs w-[180px]">
            Connect {wallet.metadata?.name ?? wallet.id}
          </button>
        ))}
    </div>
  )
}
