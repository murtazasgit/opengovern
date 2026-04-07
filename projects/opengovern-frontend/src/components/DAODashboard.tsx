import React, { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import type { DAO, Proposal, CreateProposalForm } from '../interfaces/dao'
import { shortenAddress, microAlgoToAlgo } from '../utils/algorand'
import { DaoClient } from '../contracts/DaoClient'
import { getAlgodClient } from '../utils/algorand'
import { txnSuccess, txnError } from '../utils/txnToast'
import { enableDiscussion, getDiscussionStatuses } from '../utils/discussions'
import ProposalCard from './ProposalCard'
import CreateProposalModal from './CreateProposalModal'
import { removeDAO } from '../utils/daoRegistry'

/** Safely extract txId from algod sendRawTransaction response. */
function extractTxId(result: unknown): string {
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>
    return String(r.txid ?? r.txId ?? '')
  }
  return ''
}

interface DAODashboardProps {
  dao: DAO
}

/** Derive a high-level status from raw proposal fields. */
function deriveStatus(p: {
  executed: boolean
  passed: boolean
  deadline: number
  rageQuitDeadline: number
  remainingAmount: number
}): Proposal['status'] {
  if (p.executed || (p.passed && p.remainingAmount === 0)) return 'executed'
  if (p.passed) return 'passed'
  const now = Math.floor(Date.now() / 1000)
  if (now <= p.deadline) return 'active'
  return 'rejected'
}

const DAODashboard: React.FC<DAODashboardProps> = ({ dao }) => {
  const { activeAddress, transactionSigner } = useWallet()

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [treasuryBalance, setTreasuryBalance] = useState<number>(0)
  const [actionPending, setActionPending] = useState(false)
  const [isMember, setIsMember] = useState(false)
  const [discussionMap, setDiscussionMap] = useState<Record<number, boolean>>({})

  // Whitelist management state
  const [whitelistInput, setWhitelistInput] = useState('')
  const [whitelistedAddresses, setWhitelistedAddresses] = useState<string[]>([])
  const [showWhitelistPanel, setShowWhitelistPanel] = useState(false)
  const [isWhitelisted, setIsWhitelisted] = useState(false)

  const isCreator = activeAddress === dao.creator
  const isWhitelistMode = dao.membershipType === 0
  const isStakeMode = dao.membershipType === 1

  const algod = getAlgodClient()
  const client = activeAddress ? new DaoClient(dao.appId, algod, activeAddress) : null

  // ── Fetch proposals from chain ───────────────────────────────────────────

  const fetchProposals = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const daoClient = new DaoClient(dao.appId, algod, activeAddress ?? '')
      const globalState = await daoClient.getGlobalState()
      const count = Number(globalState.proposalCount)

      const fetched: Proposal[] = []
      for (let i = 0; i < count; i++) {
        try {
          const raw = await daoClient.getProposal(BigInt(i))
          let userHasVoted = false
          if (activeAddress) {
            userHasVoted = await daoClient.hasVoted(BigInt(i), activeAddress)
          }

          fetched.push({
            id: i,
            title: raw.title,
            description: raw.description,
            recipient: raw.recipient,
            amount: Number(raw.amount),
            remainingAmount: Number(raw.remainingAmount),
            yesVotes: Number(raw.yesVotes),
            noVotes: Number(raw.noVotes),
            deadline: Number(raw.deadline),
            executed: raw.executed,
            passed: raw.passed,
            rageQuitDeadline: Number(raw.rageQuitDeadline),
            status: deriveStatus({
              executed: raw.executed,
              passed: raw.passed,
              deadline: Number(raw.deadline),
              rageQuitDeadline: Number(raw.rageQuitDeadline),
              remainingAmount: Number(raw.remainingAmount),
            }),
            userHasVoted,
          })
        } catch {
          // skip individual proposal errors
        }
      }

      setProposals(fetched)

      // Batch-load discussion statuses
      const indexes = fetched.map((p) => p.id)
      const statuses = await getDiscussionStatuses(Number(dao.appId), indexes)
      setDiscussionMap(statuses)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch proposals')
    } finally {
      setLoading(false)
    }
  }, [dao.appId, activeAddress])

  // ── Fetch treasury balance ───────────────────────────────────────────────

  const fetchTreasury = useCallback(async () => {
    try {
      const info = await algod.accountInformation(dao.treasuryAddress).do()
      const rawAmount = info as unknown as Record<string, unknown>
      const amount = (rawAmount.amount ?? rawAmount['amount']) as number
      setTreasuryBalance(amount)
    } catch {
      // Silently fail — treasury may not be funded yet
    }
  }, [dao.treasuryAddress])

  const checkMembership = useCallback(async () => {
    if (!activeAddress) {
      setIsMember(false)
      return
    }
    try {
      const info = (await algod.accountApplicationInformation(activeAddress, Number(dao.appId)).do()) as unknown as Record<string, unknown>
      const localState = info['appLocalState'] ?? info['app-local-state']
      if (localState) {
        setIsMember(true)
      } else {
        setIsMember(false)
      }
    } catch {
      setIsMember(false)
    }
  }, [activeAddress, dao.appId])

  // ── Check if current wallet is whitelisted ───────────────────────────────

  const checkWhitelistStatus = useCallback(async () => {
    if (!activeAddress || !isWhitelistMode) {
      setIsWhitelisted(false)
      return
    }
    try {
      const daoClient = new DaoClient(dao.appId, algod, activeAddress)
      const result = await daoClient.isWhitelisted(activeAddress)
      setIsWhitelisted(result)
    } catch {
      setIsWhitelisted(false)
    }
  }, [activeAddress, dao.appId, isWhitelistMode])

  useEffect(() => {
    fetchProposals()
    fetchTreasury()
    checkMembership()
    checkWhitelistStatus()
  }, [fetchProposals, fetchTreasury, checkMembership, checkWhitelistStatus])

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Join (whitelist self-claim) */
  const handleJoinWhitelist = async () => {
    if (!client || !transactionSigner) return
    setActionPending(true)
    try {
      const txns = await client.buildOptInMember()
      const signed = await transactionSigner(
        txns,
        txns.map((_, i) => i),
      )
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)
      txnSuccess('Claimed membership', txId)
      setIsMember(true)
    } catch (err) {
      txnError('Failed to claim membership', err)
      setError(err instanceof Error ? err.message : 'Failed to claim membership')
    } finally {
      setActionPending(false)
    }
  }

  /** Join (stake ALGO) */
  const handleJoinStake = async () => {
    if (!client || !transactionSigner) return
    setActionPending(true)
    try {
      const txns = await client.buildStakeJoin(dao.minimumStake)
      const signed = await transactionSigner(
        txns,
        txns.map((_, i) => i),
      )
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)
      txnSuccess(`Staked ${microAlgoToAlgo(dao.minimumStake)} ALGO to join`, txId)
      setIsMember(true)
    } catch (err) {
      txnError('Failed to stake and join', err)
      setError(err instanceof Error ? err.message : 'Failed to stake and join')
    } finally {
      setActionPending(false)
    }
  }

  /** Leave DAO (close out, returns stake if applicable) */
  const handleLeaveDao = async () => {
    if (!client || !transactionSigner) return
    const confirmed = window.confirm(
      isStakeMode ? `Leave this DAO? Your staked ALGO will be returned.` : 'Leave this DAO? You will need to be re-whitelisted to rejoin.',
    )
    if (!confirmed) return
    setActionPending(true)
    try {
      const txns = await client.buildLeaveDao()
      const signed = await transactionSigner(
        txns,
        txns.map((_, i) => i),
      )
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)
      txnSuccess('Left DAO', txId)
      setIsMember(false)
    } catch (err) {
      txnError('Failed to leave DAO', err)
    } finally {
      setActionPending(false)
    }
  }

  /** Add address to whitelist (creator only) */
  const handleAddToWhitelist = async () => {
    if (!client || !transactionSigner) return
    const address = whitelistInput.trim()
    if (!address) return

    // Validate Algorand address
    try {
      algosdk.decodeAddress(address)
    } catch {
      txnError('Invalid address', new Error('Please enter a valid Algorand address'))
      return
    }

    setActionPending(true)
    try {
      const txns = await client.buildAddToWhitelist(address)
      const signed = await transactionSigner(
        txns,
        txns.map((_, i) => i),
      )
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)
      txnSuccess(`Whitelisted ${shortenAddress(address)}`, txId)
      setWhitelistInput('')
      setWhitelistedAddresses((prev) => [...prev, address])
    } catch (err) {
      txnError('Failed to add to whitelist', err)
    } finally {
      setActionPending(false)
    }
  }

  /** Remove address from whitelist (creator only) */
  const handleRemoveFromWhitelist = async (address: string) => {
    if (!client || !transactionSigner) return
    setActionPending(true)
    try {
      const txns = await client.buildRemoveFromWhitelist(address)
      const signed = await transactionSigner(
        txns,
        txns.map((_, i) => i),
      )
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)
      txnSuccess(`Removed ${shortenAddress(address)} from whitelist`, txId)
      setWhitelistedAddresses((prev) => prev.filter((a) => a !== address))
    } catch (err) {
      txnError('Failed to remove from whitelist', err)
    } finally {
      setActionPending(false)
    }
  }

  const handleFundTreasury = async () => {
    if (!activeAddress || !transactionSigner) return
    const input = window.prompt('Enter amount of ALGO to fund the treasury with:')
    if (!input) return

    const amountAlgo = parseFloat(input)
    if (isNaN(amountAlgo) || amountAlgo <= 0) {
      txnError('Invalid amount', new Error('Amount must be a positive number'))
      return
    }

    setActionPending(true)
    try {
      const sp = await algod.getTransactionParams().do()
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: dao.treasuryAddress,
        amount: Math.round(amountAlgo * 1_000_000),
        suggestedParams: sp,
      })

      const signed = await transactionSigner([txn], [0])
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)
      txnSuccess(`Successfully funded ${amountAlgo} ALGO`, txId)
      await fetchTreasury()
    } catch (err) {
      txnError('Failed to fund treasury', err)
      setError(err instanceof Error ? err.message : 'Failed to fund treasury')
    } finally {
      setActionPending(false)
    }
  }

  const handleCreateProposal = async (form: CreateProposalForm) => {
    if (!client || !transactionSigner) return
    setActionPending(true)
    try {
      const amountMicro = BigInt(Math.round(form.amountAlgo * 1_000_000))
      const txns = await client.buildCreateProposal(form.title, form.description, form.recipient, amountMicro)
      const signed = await transactionSigner(
        txns,
        txns.map((_, i) => i),
      )
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)
      txnSuccess('Proposal created', txId)

      // Save discussion setting to Supabase
      try {
        const globalState = await client.getGlobalState()
        const newIndex = Number(globalState.proposalCount) - 1
        await enableDiscussion(Number(dao.appId), newIndex, form.discussionEnabled)
      } catch {
        // Non-critical — discussion setting may fail silently
      }

      setShowCreateModal(false)
      await fetchProposals()
    } catch (err) {
      txnError('Failed to create proposal', err)
      setError(err instanceof Error ? err.message : 'Failed to create proposal')
    } finally {
      setActionPending(false)
    }
  }

  const handleVote = async (proposalId: number, yes: boolean) => {
    if (!client || !transactionSigner) return
    setActionPending(true)
    try {
      const txns = await client.buildVote(BigInt(proposalId), yes)
      const signed = await transactionSigner(
        txns,
        txns.map((_, i) => i),
      )
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)
      txnSuccess(`Voted ${yes ? 'YES' : 'NO'} on proposal #${proposalId}`, txId)
      await fetchProposals()
    } catch (err) {
      txnError('Failed to vote', err)
      setError(err instanceof Error ? err.message : 'Failed to vote')
    } finally {
      setActionPending(false)
    }
  }

  const handleFinalize = async (proposalId: number) => {
    if (!client || !transactionSigner) return
    setActionPending(true)
    try {
      const txns = await client.buildFinalizeProposal(BigInt(proposalId))
      const signed = await transactionSigner(
        txns,
        txns.map((_, i) => i),
      )
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)
      txnSuccess(`Proposal #${proposalId} finalized`, txId)
      await fetchProposals()
    } catch (err) {
      txnError('Failed to finalize', err)
      setError(err instanceof Error ? err.message : 'Failed to finalize')
    } finally {
      setActionPending(false)
    }
  }

  const handleExecute = async (proposalId: number) => {
    if (!client || !transactionSigner) return
    const proposal = proposals.find((p) => p.id === proposalId)
    if (!proposal) return
    setActionPending(true)
    try {
      const txns = await client.buildExecuteProposal(BigInt(proposalId), BigInt(proposal.remainingAmount))
      const signed = await transactionSigner(
        txns,
        txns.map((_, i) => i),
      )
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)
      txnSuccess(`Proposal #${proposalId} executed`, txId)
      await fetchProposals()
      await fetchTreasury()
    } catch (err) {
      txnError('Failed to execute', err)
      setError(err instanceof Error ? err.message : 'Failed to execute')
    } finally {
      setActionPending(false)
    }
  }

  const handleDeleteDao = async () => {
    if (!client || !transactionSigner) return
    const confirmed = window.confirm(
      'Are you sure you want to PERMANENTLY DELETE this DAO? This will close the application and return all treasury funds to you.',
    )
    if (!confirmed) return
    setActionPending(true)
    try {
      const txns = await client.buildDeleteDao()
      const signed = await transactionSigner(
        txns,
        txns.map((_, i) => i),
      )
      const result = await algod.sendRawTransaction(signed).do()
      const txId = extractTxId(result)
      if (txId) await algosdk.waitForConfirmation(algod, txId, 4)

      // Remove from local/global registry
      await removeDAO(Number(dao.appId))

      txnSuccess('DAO deleted and treasury funds reclaimed', txId)
      window.location.href = '/' // Redirect to home
    } catch (err) {
      txnError('Failed to delete DAO', err)
    } finally {
      setActionPending(false)
    }
  }

  // ── Join button renderer ────────────────────────────────────────────────

  const renderJoinButton = () => {
    if (isWhitelistMode) {
      if (isCreator || isWhitelisted) {
        return (
          <button
            onClick={handleJoinWhitelist}
            className="btn-secondary-web3 text-xs px-4 py-2"
            disabled={actionPending}
            data-test-id="claim-membership-btn"
          >
            {actionPending ? '⏳ ' : '📋 '}Claim Membership
          </button>
        )
      }
      return <span className="font-mono text-xs text-black/50 italic uppercase tracking-widest px-4">🔒 Not on the whitelist</span>
    }

    // Stake mode
    return (
      <button
        onClick={handleJoinStake}
        className="btn-secondary-web3 text-xs px-4 py-2"
        disabled={actionPending}
        data-test-id="stake-join-btn"
      >
        {actionPending ? '⏳ ' : '🔒 '}Stake {microAlgoToAlgo(dao.minimumStake)} ALGO to Join
      </button>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto py-4">
      {/* Container for DAO and Proposals to make them look strictly connected */}
      <div className="panel-web3 bg-white relative overflow-hidden flex flex-col mb-8 p-0">
        {/* DAO Header */}
        <div className="p-6 md:p-8 relative">
          {/* Decorative notch */}
          <div className="absolute top-0 right-12 w-8 h-8 border-b-2 border-l-2 border-black bg-[#fbbf24] transform -translate-y-1/2 z-10"></div>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-extrabold uppercase tracking-tight text-[#7c3aed]">{dao.name}</h1>
                {/* Template badge */}
                <span
                  className={`
                inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest
                border-2 border-black shadow-[2px_2px_0_#000]
                ${isWhitelistMode ? 'bg-[#dbeafe] text-[#1e40af]' : 'bg-[#dcfce7] text-[#166534]'}
              `}
                >
                  {isWhitelistMode ? '📋 Whitelist' : '🔒 Stake'}
                </span>
              </div>
              <p className="text-sm text-black/60 leading-relaxed">{dao.description}</p>
              <div className="font-mono text-[10px] text-black/40 mt-2 uppercase tracking-widest">
                App ID: {dao.appId.toString()} · {shortenAddress(dao.treasuryAddress)}
                {isStakeMode && <span className="ml-2 text-[#166534]">· Min Stake: {microAlgoToAlgo(dao.minimumStake)} ALGO</span>}
              </div>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatBox label="Treasury" value={`${microAlgoToAlgo(treasuryBalance).toFixed(2)}`} unit="ALGO" />
            <StatBox label="Members" value={dao.memberCount.toString()} />
            <StatBox label="Quorum" value={dao.quorum.toString()} />
            <StatBox label="Threshold" value={`${dao.threshold}%`} />
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap gap-3 pt-4 border-t-2 border-dashed border-black/10">
            {activeAddress ? (
              <>
                {!isMember ? (
                  renderJoinButton()
                ) : (
                  <>
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="btn-primary-web3 text-xs px-4 py-2"
                      disabled={actionPending}
                      data-test-id="create-proposal-btn"
                    >
                      + Create Proposal
                    </button>
                    <button
                      onClick={handleFundTreasury}
                      className="btn-web3 bg-[#6d28d9] text-white hover:bg-[#5b21b6] text-xs px-4 py-2"
                      disabled={actionPending}
                      data-test-id="fund-treasury-btn"
                    >
                      Fund Treasury
                    </button>
                    <button
                      onClick={handleLeaveDao}
                      className="btn-secondary-web3 text-xs px-4 py-2 hover:bg-red-50 hover:text-red-700 hover:border-red-400"
                      disabled={actionPending}
                      data-test-id="leave-dao-btn"
                    >
                      Leave DAO
                    </button>
                  </>
                )}
                {/* Whitelist management button for creator */}
                {isCreator && isWhitelistMode && (
                  <button
                    onClick={() => setShowWhitelistPanel(!showWhitelistPanel)}
                    className="btn-web3 bg-[#1e40af] text-white hover:bg-[#1e3a8a] text-xs px-4 py-2"
                    disabled={actionPending}
                  >
                    {showWhitelistPanel ? '✕ Close Whitelist' : '📝 Manage Whitelist'}
                  </button>
                )}
                <button
                  onClick={() => {
                    fetchProposals()
                    fetchTreasury()
                    checkMembership()
                    checkWhitelistStatus()
                  }}
                  className="btn-secondary-web3 text-xs px-4 py-2"
                  disabled={loading}
                >
                  ↻ Refresh
                </button>
                {/* Danger Zone */}
                {isCreator && (
                  <div className="flex-none sm:border-l-2 sm:border-black/10 sm:pl-3">
                    <button
                      onClick={handleDeleteDao}
                      className="btn-web3 bg-red-600 text-white hover:bg-red-700 text-[10px] px-3 py-2 border-black"
                      disabled={actionPending}
                      title="Permanently delete this DAO and reclaim treasury"
                    >
                      {actionPending ? '⏳' : '☠️'} Delete DAO
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="font-mono text-xs text-black/40 italic uppercase tracking-widest">
                Connect your wallet to interact with this DAO
              </p>
            )}
          </div>
        </div>

        {/* ── Whitelist Management Panel (creator only) ── */}
        {showWhitelistPanel && isCreator && isWhitelistMode && (
          <div className="p-6 md:p-8 border-t-[4px] border-black bg-[#fdfdfd] relative">
            <div className="absolute top-0 left-8 w-6 h-6 border-b-2 border-r-2 border-black bg-[#dbeafe] transform -translate-y-1/2 z-10"></div>
            <h2 className="text-xl font-extrabold uppercase tracking-tight mb-4 flex items-center gap-2">
              <span className="text-[#1e40af]">📝</span> Whitelist Management
            </h2>
            <p className="text-xs text-black/50 font-mono uppercase tracking-widest mb-4">
              Add wallet addresses that can claim membership in your DAO.
            </p>

            {/* Add address form */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Algorand address (e.g. ABCD…)"
                value={whitelistInput}
                onChange={(e) => setWhitelistInput(e.target.value)}
                className="flex-1 border-2 border-black px-3 py-2 font-mono text-sm bg-[#f5f3ff]
                         shadow-[3px_3px_0_#000] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
              />
              <button
                onClick={handleAddToWhitelist}
                className="btn-primary-web3 text-xs px-6 py-2 whitespace-nowrap"
                disabled={actionPending || !whitelistInput.trim()}
              >
                {actionPending ? '⏳' : '+'} Add
              </button>
            </div>

            {/* Whitelisted addresses list */}
            {whitelistedAddresses.length > 0 && (
              <div className="border-t-2 border-dashed border-black/10 pt-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-black/40 mb-2">
                  Recently Added ({whitelistedAddresses.length})
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {whitelistedAddresses.map((addr) => (
                    <div key={addr} className="flex items-center justify-between border-2 border-black/20 px-3 py-2 bg-[#f9fafb]">
                      <span className="font-mono text-xs text-black/70 truncate mr-2">{shortenAddress(addr)}</span>
                      <button
                        onClick={() => handleRemoveFromWhitelist(addr)}
                        className="text-red-500 hover:text-red-700 text-xs font-bold border border-red-300 px-2 py-0.5
                                 hover:bg-red-50 transition-colors"
                        disabled={actionPending}
                      >
                        ✕ Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {whitelistedAddresses.length === 0 && (
              <div className="text-center py-4 border-2 border-dashed border-black/10">
                <span className="font-mono text-xs text-black/30 uppercase">No addresses added yet in this session</span>
              </div>
            )}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="p-4 bg-red-100 border-t-[4px] border-black font-mono">
            <span className="text-sm font-bold text-red-700 uppercase">ERR:: {error}</span>
            <button onClick={() => setError(null)} className="ml-4 underline text-xs text-red-500">
              dismiss
            </button>
          </div>
        )}

        {/* Proposals section - now visually integrated inside the DAO container */}
        <div className="p-6 md:p-8 border-t-[4px] border-black bg-[#e2e8f0]">
          <div className="flex items-center justify-between mb-6 pb-2 border-b-4 border-black/20">
            <h2 className="text-2xl font-extrabold uppercase tracking-tighter text-black">
              Proposals
              {!loading && <span className="text-sm font-normal text-black/50 ml-2 font-mono">({proposals.length})</span>}
            </h2>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <span className="animate-pulse bg-black text-white px-4 py-2 font-mono text-sm uppercase shadow-[2px_2px_0_rgba(251,191,36,0.8)]">
                Loading Proposals...
              </span>
            </div>
          ) : proposals.length === 0 ? (
            <div className="p-12 text-center border-2 border-dashed border-black/30 bg-white shadow-[4px_4px_0_#94a3b8]">
              <div className="text-4xl mb-3">📋</div>
              <h3 className="font-mono text-sm uppercase tracking-widest text-black/60 mb-4">No proposals yet</h3>
              {activeAddress && isMember && (
                <button onClick={() => setShowCreateModal(true)} className="btn-primary-web3 text-xs px-6 py-2">
                  Create the first proposal
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-6">
              {proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  daoAppId={Number(dao.appId)}
                  discussionEnabled={discussionMap[proposal.id] ?? false}
                  walletAddress={activeAddress ?? null}
                  isMember={isMember}
                  onVote={(yes) => handleVote(proposal.id, yes)}
                  onFinalize={() => handleFinalize(proposal.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create proposal modal */}
      <CreateProposalModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onSubmit={handleCreateProposal} />
    </div>
  )
}

// ── Small stat box used in the header ───────────────────────────────────────

interface StatBoxProps {
  label: string
  value: string
  unit?: string
}

const StatBox: React.FC<StatBoxProps> = ({ label, value, unit }) => (
  <div className="border-2 border-black bg-[#f9f9f9] px-4 py-3 text-center shadow-[3px_3px_0px_#000]">
    <div className="font-mono text-[9px] uppercase tracking-widest text-black/40 mb-1">{label}</div>
    <div className="text-xl font-extrabold text-black">
      {value}
      {unit && <span className="text-[10px] font-normal text-black/50 ml-1 font-mono uppercase">{unit}</span>}
    </div>
  </div>
)

export default DAODashboard
