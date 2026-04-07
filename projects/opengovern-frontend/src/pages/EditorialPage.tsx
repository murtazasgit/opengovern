import React from 'react'

const EditorialPage: React.FC = () => {
  const articles = [
    {
      tag: 'SMART CONTRACTS',
      title: 'Smart Contracts on Algorand',
      excerpt:
        'Discover how to build, deploy, and interact with robust Smart Contracts using the Algorand Virtual Machine (AVM). Learn about application architectures, state management, and atomic transfers.',
      date: 'APR 2026',
      link: 'https://developer.algorand.org/docs/get-details/dapps/smart-contracts/apps/',
    },
    {
      tag: 'DATA STORAGE',
      title: 'Box Storage: Scalable Per-App State',
      excerpt:
        'Box storage provides contiguous, arbitrary-length byte arrays that allow applications to store an unbounded amount of data like metadata and large user registries without increasing base state overhead.',
      date: 'APR 2026',
      link: 'https://developer.algorand.org/docs/get-details/dapps/smart-contracts/apps/state/#box-storage',
    },
    {
      tag: 'ACCOUNTS',
      title: 'Algorand Accounts: Keys, Types & Lifecycle',
      excerpt:
        'An Algorand account represents an entity holding ALGO and tokens. Understand how accounts maintain balances, authenticate transactions securely, and handle multisig or logic signatures.',
      date: 'MAR 2026',
      link: 'https://developer.algorand.org/docs/get-details/accounts/',
    },
    {
      tag: 'TOKENS',
      title: 'Algorand Standard Assets (ASA)',
      excerpt:
        "Algorand's Layer-1 allows you to natively tokenize assets like fungible tokens, stablecoins, NFTs, and governance tokens securely with simple configuration, directly at the protocol level.",
      date: 'MAR 2026',
      link: 'https://developer.algorand.org/docs/get-details/tokens/',
    },
  ]

  return (
    <div className="flex flex-col gap-8 max-w-[100vw] overflow-x-hidden p-2">
      {/* Hero */}
      <div className="panel-web3 p-8 md:p-12 bg-white relative overflow-hidden group">
        <div className="absolute top-0 right-12 w-8 h-8 border-b-2 border-l-2 border-black bg-[#8b5cf6] transform -translate-y-1/2 group-hover:bg-[#fbbf24] transition-colors"></div>

        <h2 className="text-4xl md:text-5xl font-extrabold uppercase mb-4 drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]">
          Editorial
        </h2>
        <div className="w-full h-1 bg-black mb-6 opacity-20"></div>
        <p className="font-mono text-sm uppercase tracking-widest text-black/60">
          Deep dives into on-chain governance, treasury design, and DAO architecture on Algorand
        </p>
      </div>

      {/* Articles */}
      <div className="grid gap-6">
        {articles.map((article, i) => (
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            key={i}
            className="panel-web3 bg-white p-6 md:p-8 block group cursor-pointer hover:translate-x-1 hover:-translate-y-1 transition-transform"
          >
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <span className="bg-[#fef3c7] text-black font-bold text-[10px] px-2 py-1 uppercase tracking-wider border border-black">
                    {article.tag}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-black/30">{article.date}</span>
                </div>
                <h3 className="text-xl font-bold uppercase tracking-tight mb-2 group-hover:text-[#22c55e] transition-colors">
                  {article.title}
                </h3>
                <p className="text-sm text-black/60 leading-relaxed">{article.excerpt}</p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#22c55e] font-bold self-end md:self-start shrink-0 group-hover:translate-x-2 transition-transform">
                Read →
              </span>
            </div>
          </a>
        ))}
      </div>

      {/* Info */}
      <div className="panel-web3 p-8 text-center border-dashed border-black/30 bg-white/80">
        <p className="font-mono text-xs uppercase tracking-widest text-black/40">
          All governance logic is fully on-chain. Inspect the smart contract to verify every claim.
        </p>
      </div>
    </div>
  )
}

export default EditorialPage
