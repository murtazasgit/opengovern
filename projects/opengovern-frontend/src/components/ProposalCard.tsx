import React, { useEffect, useState } from 'react'
import type { Proposal } from '../interfaces/dao'
import { shortenAddress, microAlgoToAlgo } from '../utils/algorand'
import DiscussionSection from './DiscussionSection'

interface ProposalCardProps {
  proposal: Proposal
  daoAppId: number
  discussionEnabled: boolean
  walletAddress: string | null
  isMember: boolean
  memberCount: number
  onVote: (yes: boolean) => void
  onFinalize: () => void
}

/** Human-readable countdown string from a unix-second deadline. */
function formatTimeRemaining(deadlineSeconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = deadlineSeconds - now

  if (diff <= 0) return 'Ended'

  const d = Math.floor(diff / 86400)
  const h = Math.floor((diff % 86400) / 3600)
  const m = Math.floor((diff % 3600) / 60)

  if (d > 0) return `${d}d ${h}h remaining`
  if (h > 0) return `${h}h ${m}m remaining`
  return `${m}m remaining`
}

const STATUS_BADGE: Record<Proposal['status'], { label: string; bg: string; text: string }> = {
  active: { label: 'ACTIVE', bg: 'bg-[#fbbf24]', text: 'text-black' },
  passed: { label: 'PASSED', bg: 'bg-[#00ff88]', text: 'text-black' },
  rejected: { label: 'REJECTED', bg: 'bg-red-500', text: 'text-white' },
  executed: { label: 'EXECUTED', bg: 'bg-[#7c3aed]', text: 'text-white' },
}

const ProposalCard: React.FC<ProposalCardProps> = ({
  proposal,
  daoAppId,
  discussionEnabled,
  walletAddress,
  isMember,
  memberCount,
  onVote,
  onFinalize,
}) => {
  const [timeLeft, setTimeLeft] = useState(() => formatTimeRemaining(proposal.deadline))

  // Tick the countdown every 30s
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(formatTimeRemaining(proposal.deadline))
    }, 30_000)
    return () => clearInterval(timer)
  }, [proposal.deadline])

  const totalVotes = proposal.yesVotes + proposal.noVotes
  const yesPct = totalVotes > 0 ? Math.round((proposal.yesVotes / totalVotes) * 100) : 0
  const noPct = totalVotes > 0 ? 100 - yesPct : 0

  const badge = STATUS_BADGE[proposal.status]
  const isVotingOpen = proposal.status === 'active' && proposal.deadline > Math.floor(Date.now() / 1000)
  
  // Early Finalization logic (Absolute Majority)
  const isAbsoluteMajority = memberCount > 0 && proposal.yesVotes > Math.floor(memberCount / 2)
  const canFinalize = (proposal.status === 'active') && (proposal.deadline <= Math.floor(Date.now() / 1000) || isAbsoluteMajority)
  const canExecute = proposal.status === 'passed' && !proposal.executed

  return (
    <div className="bg-white p-5 border-2 border-black shadow-[3px_3px_0px_rgba(0,0,0,0.1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all duration-200">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-lg uppercase tracking-tight truncate">
            <span className="text-black/40 mr-1">#{proposal.id}</span>
            {proposal.title}
          </h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {discussionEnabled && (
            <span className="px-2 py-1 text-[10px] font-bold font-mono tracking-widest uppercase border border-black/20 bg-[#fef3c7] text-black/60">
              💬
            </span>
          )}
          {isAbsoluteMajority && proposal.status === 'active' && (
            <span className="px-2 py-1 text-[10px] font-bold font-mono tracking-widest uppercase border border-black bg-blue-500 text-white shrink-0 shadow-[1px_1px_0px_#000]">
              GUARANTEED
            </span>
          )}
          <span
            className={`${badge.bg} ${badge.text} px-2 py-1 text-[10px] font-bold font-mono tracking-widest uppercase border border-black shrink-0`}
          >
            {badge.label}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-black/60 line-clamp-2 mb-4 leading-relaxed">{proposal.description}</p>

      {/* Recipient + Amount */}
      <div className="flex items-center justify-between text-sm border-t-2 border-dashed border-black/10 pt-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-black/40">To:</span>
          <span className="font-mono text-xs text-black/80" title={proposal.recipient}>
            {shortenAddress(proposal.recipient)}
          </span>
        </div>
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-black/40 mr-1">Amount:</span>
          <span className="font-bold text-[#7c3aed] font-mono text-sm">{microAlgoToAlgo(proposal.amount).toFixed(2)} A</span>
        </div>
      </div>

      {/* Vote bars */}
      <div className="space-y-4 mb-5 mt-2">
        {/* YES bar */}
        <div>
          <div className="flex justify-between items-end font-mono uppercase tracking-widest mb-1.5">
            <span className="font-extrabold text-sm text-green-600">YES</span>
            <span className="text-xs text-black/50 font-bold tracking-normal">
              {proposal.yesVotes} vote{proposal.yesVotes !== 1 ? 's' : ''} ({yesPct}%)
            </span>
          </div>
          <div className="w-full bg-gray-200 h-4 border border-black/10 overflow-hidden">
            <div className="bg-green-500 h-full transition-all duration-500" style={{ width: `${yesPct}%` }} />
          </div>
        </div>

        {/* NO bar */}
        <div>
          <div className="flex justify-between items-end font-mono uppercase tracking-widest mb-1.5">
            <span className="font-extrabold text-sm text-red-500">NO</span>
            <span className="text-xs text-black/50 font-bold tracking-normal">
              {proposal.noVotes} vote{proposal.noVotes !== 1 ? 's' : ''} ({noPct}%)
            </span>
          </div>
          <div className="w-full bg-gray-200 h-4 border border-black/10 overflow-hidden">
            <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${noPct}%` }} />
          </div>
        </div>
      </div>

      {/* Time + remaining amount */}
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-black/40 mb-4">
        <span>⏱ {timeLeft}</span>
        {proposal.remainingAmount > 0 && proposal.remainingAmount !== proposal.amount && (
          <span>Remaining: {microAlgoToAlgo(proposal.remainingAmount).toFixed(2)} A</span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap justify-end gap-3 pt-3 border-t-2 border-dashed border-black/10">
        {isVotingOpen && (
          <>
            {proposal.userHasVoted ? (
              <span className="text-xs px-4 py-2 font-mono uppercase tracking-widest text-black/40 italic flex items-center w-full justify-center sm:w-auto">
                ✓ Already Voted
              </span>
            ) : (
              <div className="flex flex-wrap justify-end gap-2 w-full">
                <button
                  onClick={() => onVote(true)}
                  className="btn-web3 bg-green-100 text-green-800 hover:bg-green-200 text-xs px-4 py-2 border-green-600 flex-1"
                  data-test-id="vote-yes-btn"
                >
                  VOTE YES
                </button>
                <button
                  onClick={() => onVote(false)}
                  className="btn-web3 bg-red-100 text-red-800 hover:bg-red-200 text-xs px-4 py-2 border-red-500 flex-1 sm:flex-initial"
                  data-test-id="vote-no-btn"
                >
                  VOTE NO
                </button>
              </div>
            )}
          </>
        )}

        {canFinalize && (
          <button
            onClick={onFinalize}
            className="btn-web3 bg-[#fbbf24] text-black hover:bg-[#f59e0b] text-xs px-4 py-2 border-2 border-black animate-pulse w-full sm:w-auto"
            data-test-id="finalize-btn"
          >
            {isAbsoluteMajority ? 'Auto-Execute Now' : 'Finalize & Execute'}
          </button>
        )}
      </div>

      {/* Discussion Section */}
      {discussionEnabled && (
        <DiscussionSection daoAppId={daoAppId} proposalIndex={proposal.id} walletAddress={walletAddress} isMember={isMember} />
      )}
    </div>
  )
}

export default ProposalCard
