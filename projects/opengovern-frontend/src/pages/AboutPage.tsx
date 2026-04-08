import React from 'react'

const AboutPage: React.FC = () => {
  return (
    <div className="flex flex-col gap-8 w-full">
      {/* Hero */}
      <div className="panel-web3 p-6 md:p-12 bg-white relative overflow-hidden group">
        <div className="absolute top-0 right-12 w-8 h-8 border-b-2 border-l-2 border-black bg-black transform -translate-y-1/2 group-hover:bg-[#fbbf24] transition-colors"></div>

        <h2 className="text-2xl sm:text-4xl md:text-5xl font-extrabold uppercase mb-4 drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]">About</h2>
        <div className="w-full h-1 bg-black mb-6 opacity-20"></div>

        <div className="space-y-6 max-w-3xl">
          <p className="text-xl font-bold font-mono uppercase tracking-widest text-black/70">
            On-Chain DAO Treasury Governance on Algorand
          </p>
          <p className="text-sm text-black/70 leading-relaxed">
            Decentralised Autonomous Organisations (DAOs) rely on transparent, tamper-proof governance to manage shared funds. When every
            vote and every payout is recorded on-chain, community members can verify outcomes without trusting a central administrator.
          </p>
          <p className="text-sm text-black/70 leading-relaxed">
            OpenGovern is a DAO treasury app where proposals are created on-chain, votes are recorded per wallet, and funds are released
            only after sufficient approval — all enforced by smart-contract logic. Small communities and working groups can collectively
            decide how shared funds are spent, without relying on a single trusted treasurer.
          </p>

          {/* Key Features */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
            {[
              {
                icon: '📦',
                title: 'Box-Stored Proposals',
                desc: 'All proposal metadata (title, description, amount, recipient) stored in Algorand contract boxes — fully on-chain.',
              },
              {
                icon: '🗳️',
                title: 'One Vote Per Wallet',
                desc: 'Duplicate votes from the same address are rejected by the contract. Fair, verifiable, tamper-proof voting.',
              },
              {
                icon: '⚖️',
                title: 'Quorum & Threshold',
                desc: 'Configurable minimum participation (quorum) and approval percentage (threshold) checked before any payout.',
              },
              {
                icon: '💰',
                title: 'On-Chain Treasury',
                desc: 'Funds held in the application account. Disbursed only after a proposal passes all on-chain governance checks.',
              },
              {
                icon: '🔒',
                title: 'Dual Membership',
                desc: 'Two membership models — Whitelist + Self-Claim for trusted groups, or Stake-to-Join for spam resistance.',
              },
              {
                icon: '⚡',
                title: 'Instant Finality',
                desc: "Proposals execute with Algorand's 3.3s block time. Vote → finalize → execute with near-instant confirmation.",
              },
            ].map((feature) => (
              <div key={feature.title} className="border-2 border-black p-5 bg-[#f9f9f9] shadow-[3px_3px_0px_#000]">
                <div className="text-2xl mb-2">{feature.icon}</div>
                <h3 className="font-bold uppercase tracking-tight text-sm mb-1">{feature.title}</h3>
                <p className="text-xs text-black/60 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="panel-web3 bg-white p-6 md:p-8">
        <h3 className="text-2xl font-extrabold uppercase tracking-tighter mb-6 border-b-4 border-black pb-3">How It Works</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              step: '01',
              title: 'Create DAO',
              desc: 'Deploy a new DAO smart contract with your governance rules — quorum, threshold, voting duration, and membership model.',
            },
            {
              step: '02',
              title: 'Fund Treasury',
              desc: 'Send ALGO to the DAO application account. All treasury funds are held on-chain and visible to every member.',
            },
            {
              step: '03',
              title: 'Propose & Vote',
              desc: 'Members create funding proposals. Each wallet gets exactly one vote. Votes are recorded on-chain and cannot be changed.',
            },
            {
              step: '04',
              title: 'Execute Payout',
              desc: 'If quorum and threshold are met, the proposal can be executed — transferring funds to the recipient on-chain.',
            },
          ].map((item) => (
            <div key={item.step} className="border-2 border-dashed border-black/20 p-4">
              <div className="text-3xl font-extrabold text-[#7c3aed]/20 mb-2">{item.step}</div>
              <div className="font-extrabold uppercase text-sm mb-1">{item.title}</div>
              <div className="text-xs text-black/50 leading-relaxed">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tech Stack */}
      <div className="panel-web3 bg-white p-6 md:p-8">
        <h3 className="text-2xl font-extrabold uppercase tracking-tighter mb-6 border-b-4 border-black pb-3">Tech Stack</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { name: 'Algorand', detail: 'L1 Blockchain' },
            { name: 'Puya / algopy', detail: 'Smart Contracts' },
            { name: 'React + Vite', detail: 'Frontend' },
            { name: 'AlgoKit', detail: 'Dev Tooling' },
          ].map((tech) => (
            <div key={tech.name} className="border-2 border-dashed border-black/20 p-4 text-center">
              <div className="font-extrabold uppercase text-lg">{tech.name}</div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-black/40 mt-1">{tech.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Open Source */}
      <div className="border-2 border-black bg-black text-white p-8 shadow-[6px_6px_0px_rgba(251,191,36,0.8)]">
        <h3 className="text-xl font-extrabold uppercase tracking-tight mb-3 text-[#fbbf24]">Fully Transparent</h3>
        <p className="text-sm text-white/70 leading-relaxed max-w-2xl">
          Every proposal, vote, and payout is recorded on the Algorand blockchain. No off-chain secrets, no trusted administrators. Inspect
          the smart contract, audit the logic, and verify every transaction on-chain.
        </p>
        <div className="mt-4 font-mono text-[10px] uppercase tracking-widest text-white/40">
          Built with algopy · Algorand AVM · Box Storage · One-Wallet-One-Vote
        </div>
      </div>
    </div>
  )
}

export default AboutPage
