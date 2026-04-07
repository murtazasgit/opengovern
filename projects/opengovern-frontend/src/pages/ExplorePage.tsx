import React from 'react'
import { Link } from 'react-router-dom'

const ExplorePage: React.FC = () => {
  return (
    <div className="flex flex-col gap-8 max-w-[100vw] overflow-x-hidden p-2">
      {/* Hero */}
      <div className="panel-web3 p-8 md:p-12 bg-white relative overflow-hidden group">
        <div className="absolute top-0 right-12 w-8 h-8 border-b-2 border-l-2 border-black bg-[#fbbf24] transform -translate-y-1/2 group-hover:bg-[#8b5cf6] transition-colors"></div>

        <h2 className="text-4xl md:text-5xl font-extrabold uppercase mb-4 drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]">
          Explore
        </h2>
        <div className="w-full h-1 bg-black mb-6 opacity-20"></div>
        <p className="font-mono text-sm uppercase tracking-widest text-black/60 mb-8">
          Browse active DAOs, proposals, and on-chain treasury activity
        </p>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="border-2 border-black p-6 bg-[#f9f9f9] shadow-[4px_4px_0px_#000] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all">
            <div className="text-3xl mb-3">🏛️</div>
            <h3 className="font-bold uppercase tracking-tight text-lg mb-2">Active DAOs</h3>
            <p className="text-sm text-black/60 leading-relaxed">
              Browse live DAO treasuries deployed on Algorand. Each DAO has its own on-chain governance rules, membership model, and
              treasury balance.
            </p>
            <Link to="/" className="block mt-4 font-mono text-[10px] uppercase tracking-widest text-[#22c55e] hover:underline font-bold">
              View All DAOs →
            </Link>
          </div>

          <div className="border-2 border-black p-6 bg-[#f9f9f9] shadow-[4px_4px_0px_#000] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all">
            <div className="text-3xl mb-3">📊</div>
            <h3 className="font-bold uppercase tracking-tight text-lg mb-2">Proposals & Votes</h3>
            <p className="text-sm text-black/60 leading-relaxed">
              Track funding proposals, vote tallies, and payout history. Every vote is recorded on-chain with one-vote-per-wallet
              enforcement.
            </p>
            <Link to="/" className="block mt-4 font-mono text-[10px] uppercase tracking-widest text-[#22c55e] hover:underline font-bold">
              View Proposals →
            </Link>
          </div>

          <div className="border-2 border-black p-6 bg-[#f9f9f9] shadow-[4px_4px_0px_#000] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all">
            <div className="text-3xl mb-3">💰</div>
            <h3 className="font-bold uppercase tracking-tight text-lg mb-2">Treasury Payouts</h3>
            <p className="text-sm text-black/60 leading-relaxed">
              Verify executed payouts on-chain. Funds are only released after quorum and approval threshold are met — no admin override
              possible.
            </p>
            <Link to="/" className="block mt-4 font-mono text-[10px] uppercase tracking-widest text-[#22c55e] hover:underline font-bold">
              View Payouts →
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Banner removed as it contained fake data */}
    </div>
  )
}

export default ExplorePage
