import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import type { DAO, CreateDaoForm } from './interfaces/dao'
import { DaoClient } from './contracts/DaoClient'
import { getAlgodClient, algoToMicroAlgo } from './utils/algorand'
import DAOCard from './components/DAOCard'
import CreateDAOModal from './components/CreateDAOModal'
import { deployDao, fundDaoTreasury } from './contracts/deployDao'
import { getAllDAOs, addDAO } from './utils/daoRegistry'
import { txnSuccess, txnError } from './utils/txnToast'
import { Pointer } from './components/ui/pointer'

const Home: React.FC = () => {
  const navigate = useNavigate()
  const { activeAddress, transactionSigner, wallets } = useWallet()

  const [daos, setDaos] = useState<DAO[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const algod = getAlgodClient()

  // ── Load DAOs from registry + chain ──────────────────────────────────────

  const loadDaos = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // 1. Read all tracked DAOs from Supabase
      const tracked = await getAllDAOs()
      const allIds = [...new Set(tracked.map((e) => e.appId))]

      // 3. Fetch global state for each known DAO
      const loaded: DAO[] = []
      for (const id of allIds) {
        try {
          const client = new DaoClient(BigInt(id), algod, '')
          const state = await client.getGlobalState()
          const treasuryAddress = algosdk.getApplicationAddress(BigInt(id)).toString()

          let treasuryBalance = 0
          try {
            const accInfo = await algod.accountInformation(treasuryAddress).do()
            treasuryBalance = Number((accInfo as any).amount)
          } catch { }

          loaded.push({
            appId: BigInt(id),
            name: state.daoName,
            description: state.description,
            quorum: Number(state.quorum),
            threshold: Number(state.threshold),
            votingDuration: Number(state.votingDuration),
            treasuryAddress,
            treasuryBalance,
            memberCount: Number(state.totalMembers),
            membershipType: Number(state.membershipType),
            minimumStake: Number(state.minimumStake),
            creator: state.creator,
          })
        } catch {
          // App might be deleted or inaccessible — skip
        }
      }

      setDaos(loaded)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load DAOs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDaos()
  }, [loadDaos])

  // ── Deploy new DAO ───────────────────────────────────────────────────────

  const handleCreateDao = async (form: CreateDaoForm) => {
    if (!activeAddress || !transactionSigner) {
      setError('Connect your wallet first')
      return
    }

    setDeploying(true)
    setError(null)

    try {
      // Read compiled TEAL from the artifacts (served from public/)
      const [approvalRes, clearRes] = await Promise.all([fetch('/Daocontract.approval.teal.b64'), fetch('/Daocontract.clear.teal.b64')])

      if (!approvalRes.ok || !clearRes.ok) {
        throw new Error(
          'Compiled TEAL not found. Place base64-encoded approval & clear programs in public/ ' +
          '(Daocontract.approval.teal.b64 and Daocontract.clear.teal.b64).',
        )
      }

      const approvalB64 = (await approvalRes.text()).trim()
      const clearB64 = (await clearRes.text()).trim()

      const result = await deployDao(
        {
          name: form.name,
          description: form.description,
          quorum: form.quorum,
          threshold: form.threshold,
          votingDuration: form.votingDurationMinutes * 60, // convert minutes → seconds
          membershipType: form.template === 'whitelist' ? 0 : 1,
          minimumStake: form.template === 'stake' ? algoToMicroAlgo(form.minimumStake) : 0,
        },
        approvalB64,
        clearB64,
        activeAddress,
        transactionSigner,
        algod,
      )

      // Fund the treasury with 0.5 ALGO for MBR + inner txn fees
      await fundDaoTreasury(result.appId, algoToMicroAlgo(0.5), activeAddress, transactionSigner, algod)

      // ── Post-deploy: whitelist addresses + auto-join creator ──────────

      const daoClient = new DaoClient(result.appId, algod, activeAddress)

      // Whitelist mode: add all addresses from the form
      if (form.template === 'whitelist' && form.whitelistAddresses.length > 0) {
        for (const addr of form.whitelistAddresses) {
          try {
            const whitelistTxns = await daoClient.buildAddToWhitelist(addr)
            const signedWl = await transactionSigner(
              whitelistTxns,
              whitelistTxns.map((_, i) => i),
            )
            const wlResult = await algod.sendRawTransaction(signedWl).do()
            const wlTxId =
              typeof wlResult === 'object' && wlResult !== null
                ? String(
                  (wlResult as unknown as Record<string, unknown>).txid ?? (wlResult as unknown as Record<string, unknown>).txId ?? '',
                )
                : ''
            if (wlTxId) await algosdk.waitForConfirmation(algod, wlTxId, 4)
          } catch (whitelistErr) {
            console.warn(`Failed to whitelist ${addr}:`, whitelistErr)
          }
        }
      }

      // Auto-join creator as member (opt-in)
      try {
        const joinTxns = await daoClient.buildOptInMember()
        const signedJoin = await transactionSigner(
          joinTxns,
          joinTxns.map((_, i) => i),
        )
        const joinResult = await algod.sendRawTransaction(signedJoin).do()
        const joinTxId =
          typeof joinResult === 'object' && joinResult !== null
            ? String(
              (joinResult as unknown as Record<string, unknown>).txid ?? (joinResult as unknown as Record<string, unknown>).txId ?? '',
            )
            : ''
        if (joinTxId) await algosdk.waitForConfirmation(algod, joinTxId, 4)
      } catch (joinErr) {
        console.warn('Auto-join creator failed:', joinErr)
      }

      // Save to Supabase registry for persistence (include template type)
      await addDAO(Number(result.appId), form.name, activeAddress)

      // Log deployment info to console
      console.log('DAO Deployed:', {
        template: form.template,
        contract_address: result.appAddress,
        config: {
          name: form.name,
          description: form.description,
          quorum: form.quorum,
          threshold: form.threshold,
          votingDuration: form.votingDurationMinutes * 60,
          ...(form.template === 'stake' ? { minimumStake: form.minimumStake } : {}),
          ...(form.template === 'whitelist' ? { whitelistedAddresses: form.whitelistAddresses.length } : {}),
        },
      })

      // Toast with explorer link
      const templateLabel = form.template === 'whitelist' ? '📋 Whitelist' : '🔒 Stake'
      txnSuccess(`${templateLabel} DAO deployed successfully`, result.txId)

      setShowCreateModal(false)
      await loadDaos()

      // Navigate to the new DAO
      navigate(`/dao/${result.appId}`)
    } catch (err) {
      txnError('Deployment failed', err)
      setError(err instanceof Error ? err.message : 'Deployment failed')
    } finally {
      setDeploying(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-12 w-full">
      {/* Intro Panel */}
      <div className="panel-web3 p-6 md:p-12 relative overflow-hidden bg-white group">
        {/* Decorative notch effect with absolute positioning */}
        <div className="absolute top-0 right-12 w-8 h-8 border-b-2 border-l-2 border-black bg-[#8b5cf6] transform -translate-y-1/2 group-hover:bg-[#fbbf24] transition-colors"></div>

        <h2 className="text-2xl sm:text-4xl md:text-5xl font-extrabold uppercase mb-6 drop-shadow-[2px_2px_0px_rgba(0,0,0,1)]">
          About OpenGovern
        </h2>
        <div className="w-full h-1 bg-black mb-8 opacity-20"></div>

        <div className="prose prose-lg max-w-none text-black font-medium leading-relaxed font-sans">
          <p className="mb-4 text-xl font-bold font-mono uppercase tracking-widest text-black/70">
            On-chain DAO treasury governance — built on Algorand.
          </p>
          <p className="mb-4 text-sm leading-relaxed text-black/70">
            OpenGovern lets communities collectively manage shared funds without a single trusted treasurer. Deploy a DAO with custom
            governance rules — set your quorum, approval threshold, and voting duration. Choose between two membership models:{' '}
            <strong>Whitelist + Self-Claim</strong> for trusted groups or <strong>Stake ALGO</strong> for spam resistance. Members create
            funding proposals (stored in Algorand boxes), vote once per wallet (duplicates rejected on-chain), and after the voting window
            closes, quorum and threshold are verified before any payout. Passed proposals execute an inner payment to the recipient, with
            support for partial disbursement. Members can leave anytime — staked ALGO is auto-refunded.
          </p>
          <ul className="list-none pl-0 mb-6 space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="text-[#7c3aed] mt-0.5">■</span>
              <span className="text-black/65">All proposal data stored on-chain in contract boxes — no off-chain dependencies</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#059669] mt-0.5">■</span>
              <span className="text-black/65">One wallet = one vote, enforced at the smart-contract level</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#fbbf24] mt-0.5">■</span>
              <span className="text-black/65">Treasury funds released only after quorum + threshold pass on-chain checks</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#e11d48] mt-0.5">■</span>
              <span className="text-black/65">Dual membership models — whitelist self-claim or stake-to-join with auto-refund on exit</span>
            </li>
          </ul>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-center gap-6 mt-8 p-6 bg-[#f9f9f9] border-2 border-dashed border-black/20">
            <div className="flex-1">
              <div className="font-bold uppercase tracking-widest mb-1 text-sm">Deploy Your DAO</div>
              <div className="text-xs opacity-60">Create a new on-chain DAO treasury with your governance rules</div>
            </div>
            <button
              onClick={() => {
                if (activeAddress) {
                  setShowCreateModal(true)
                } else {
                  const pera = wallets.find((w) => w.id === 'pera')
                  if (pera) {
                    pera.connect()
                  }
                }
              }}
              className="btn-primary-web3 w-full sm:w-auto"
            >
              {activeAddress ? 'Create DAO' : 'Connect Wallet to Start'}
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mt-8 p-4 bg-[#7c3aed]/10 border-2 border-black font-mono shadow-[4px_4px_0_#000]">
            <span className="text-sm font-bold text-black uppercase">ERR:: {error}</span>
            <button onClick={() => setError(null)} className="ml-4 underline text-xs">
              dismiss
            </button>
          </div>
        )}
      </div>

      {/* DAO List Section */}
      <div className="mt-4">
        <div className="flex flex-col sm:flex-row items-center justify-between mb-8 border-b-4 border-black pb-4 gap-4">
          <h3 className="text-3xl font-extrabold uppercase tracking-tighter">Active DAOs</h3>
          <div className="flex gap-4 items-center w-full sm:w-auto justify-between sm:justify-end">
            {loading ? (
              <span className="animate-pulse bg-black text-white px-3 py-1 font-mono text-sm uppercase shadow-[2px_2px_0_rgba(251,191,36,0.8)]">
                Loading
              </span>
            ) : (
              <button onClick={loadDaos} className="btn-secondary-web3 text-xs py-1 px-3">
                Refresh Sync
              </button>
            )}
            <span className="bg-[#fbbf24] border-2 border-black text-black px-3 py-1 font-mono font-bold text-sm shadow-[2px_2px_0_#000]">
              {daos.length} ACTIVE
            </span>
          </div>
        </div>

        {/* Content Section */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 panel-web3 bg-white/50 border-dashed border-black/20"></div>
            ))}
          </div>
        ) : daos.length === 0 ? (
          /* Empty state */
          <div className="panel-web3 p-12 text-center border-dashed border-black/30 bg-white/40 backdrop-blur-md">
            <h2 className="text-2xl font-bold mb-4 font-mono uppercase tracking-widest text-black/70">No DAOs Discovered</h2>
            <p className="text-black/50 max-w-md mx-auto mb-8 font-mono text-sm">
              Be the first to create an organization on this network, or ensure your local registry is synced.
            </p>
          </div>
        ) : (
          /* DAO grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 xl:gap-8">
            {daos.map((dao) => (
              <DAOCard key={dao.appId.toString()} dao={dao} onClick={() => navigate(`/dao/${dao.appId}`)} />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateDAOModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onSubmit={handleCreateDao} />
    </div>
  )
}

export default Home
