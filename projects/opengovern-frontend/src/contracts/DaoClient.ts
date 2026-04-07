/**
 * DaoClient — TypeScript client for the Daocontract smart contract.
 *
 * Wraps raw algosdk ApplicationCallTransactionBuilder + ABI encoding
 * into ergonomic async methods that mirror every ABI entrypoint.
 *
 * Supports both membership models:
 *   - Whitelist + Self Claim (membership_type 0)
 *   - Stake to Join (membership_type 1)
 */

import algosdk from 'algosdk'

// ─── ABI method selectors ───────────────────────────────────────────────────
const ABI_METHODS = {
  createDao: new algosdk.ABIMethod({
    name: 'create_dao',
    args: [
      { type: 'string', name: 'name' },
      { type: 'string', name: 'description' },
      { type: 'uint64', name: 'quorum' },
      { type: 'uint64', name: 'threshold' },
      { type: 'uint64', name: 'voting_duration' },
      { type: 'uint64', name: 'membership_type' },
      { type: 'uint64', name: 'minimum_stake' },
    ],
    returns: { type: 'void' },
  }),
  fundTreasury: new algosdk.ABIMethod({
    name: 'fund_treasury',
    args: [{ type: 'pay', name: 'payment' }],
    returns: { type: 'void' },
  }),
  optInMember: new algosdk.ABIMethod({
    name: 'opt_in_member',
    args: [],
    returns: { type: 'void' },
  }),
  stakeJoin: new algosdk.ABIMethod({
    name: 'stake_join',
    args: [{ type: 'pay', name: 'payment' }],
    returns: { type: 'void' },
  }),
  leaveDao: new algosdk.ABIMethod({
    name: 'leave_dao',
    args: [],
    returns: { type: 'void' },
  }),
  addToWhitelist: new algosdk.ABIMethod({
    name: 'add_to_whitelist',
    args: [{ type: 'address', name: 'address' }],
    returns: { type: 'void' },
  }),
  removeFromWhitelist: new algosdk.ABIMethod({
    name: 'remove_from_whitelist',
    args: [{ type: 'address', name: 'address' }],
    returns: { type: 'void' },
  }),
  createProposal: new algosdk.ABIMethod({
    name: 'create_proposal',
    args: [
      { type: 'string', name: 'title' },
      { type: 'string', name: 'description' },
      { type: 'address', name: 'recipient' },
      { type: 'uint64', name: 'amount' },
    ],
    returns: { type: 'uint64' },
  }),
  vote: new algosdk.ABIMethod({
    name: 'vote',
    args: [
      { type: 'uint64', name: 'proposal_id' },
      { type: 'bool', name: 'vote_yes' },
    ],
    returns: { type: 'void' },
  }),
  finalizeProposal: new algosdk.ABIMethod({
    name: 'finalize_proposal',
    args: [{ type: 'uint64', name: 'proposal_id' }],
    returns: { type: 'void' },
  }),
  executeProposal: new algosdk.ABIMethod({
    name: 'execute_proposal',
    args: [
      { type: 'uint64', name: 'proposal_id' },
      { type: 'uint64', name: 'amount' },
    ],
    returns: { type: 'void' },
  }),
  deleteDao: new algosdk.ABIMethod({
    name: 'delete_dao',
    args: [],
    returns: { type: 'void' },
  }),
}

// ─── Box key prefixes ──────────────────────────────────────────────────────
const PROPOSAL_BOX_PREFIX = new Uint8Array([0x70]) // b"p"
const WHITELIST_BOX_PREFIX = new Uint8Array([0x77]) // b"w"

// ─── Helpers ────────────────────────────────────────────────────────────────
/** Encode a uint64 as 8 big-endian bytes */
function encodeUint64(n: bigint): Uint8Array {
  const buf = new Uint8Array(8)
  const view = new DataView(buf.buffer)
  view.setBigUint64(0, n)
  return buf
}

/** Decode 8 big-endian bytes as a bigint */
function decodeUint64(bytes: Uint8Array, offset = 0): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
  return view.getBigUint64(0)
}

/** Decode a 2-byte-length-prefixed UTF-8 string from a buffer at offset */
function decodeArc4String(bytes: Uint8Array, offset: number): [string, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset)
  const len = view.getUint16(0)
  const strBytes = bytes.slice(offset + 2, offset + 2 + len)
  return [new TextDecoder().decode(strBytes), 2 + len]
}

/** Build whitelist box key for a given address */
function whitelistBoxKey(address: string): Uint8Array {
  return new Uint8Array([...WHITELIST_BOX_PREFIX, ...algosdk.decodeAddress(address).publicKey])
}

// ─── Decoded types ──────────────────────────────────────────────────────────
export interface Proposal {
  title: string
  description: string
  recipient: string
  amount: bigint
  remainingAmount: bigint
  yesVotes: bigint
  noVotes: bigint
  deadline: bigint
  executed: boolean
  passed: boolean
  rageQuitDeadline: bigint
}

export interface DaoGlobalState {
  daoName: string
  description: string
  quorum: bigint
  threshold: bigint
  votingDuration: bigint
  proposalCount: bigint
  totalMembers: bigint
  /** 0 = whitelist, 1 = stake */
  membershipType: bigint
  /** Minimum stake in microAlgos (only for stake mode) */
  minimumStake: bigint
  /** Creator address (raw bytes) */
  creator: string
}

// ─── Main client ────────────────────────────────────────────────────────────
export class DaoClient {
  readonly appId: bigint
  readonly algodClient: algosdk.Algodv2
  readonly sender: string

  private appAddress: string

  constructor(appId: bigint, algodClient: algosdk.Algodv2, sender: string) {
    this.appId = appId
    this.algodClient = algodClient
    this.sender = sender
    this.appAddress = algosdk.getApplicationAddress(appId).toString()
  }

  // ── Transaction builder helpers ──────────────────────────────────────────

  private async getSuggestedParams(): Promise<algosdk.SuggestedParams> {
    return this.algodClient.getTransactionParams().do()
  }

  // ── 1a. Opt-in as a whitelist member (self-claim) ────────────────────────

  async buildOptInMember(): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.optInMember,
      methodArgs: [],
      sender: this.sender,
      suggestedParams: sp,
      onComplete: algosdk.OnApplicationComplete.OptInOC,
      signer: algosdk.makeEmptyTransactionSigner(),
      boxes: [
        // Whitelist box reference for the sender
        { appIndex: Number(this.appId), name: whitelistBoxKey(this.sender) },
      ],
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  // ── 1b. Stake to join ────────────────────────────────────────────────────

  async buildStakeJoin(amountMicroAlgos: number): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.sender,
      receiver: this.appAddress,
      amount: amountMicroAlgos,
      suggestedParams: sp,
    })

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.stakeJoin,
      methodArgs: [{ txn: payTxn, signer: algosdk.makeEmptyTransactionSigner() }],
      sender: this.sender,
      suggestedParams: sp,
      onComplete: algosdk.OnApplicationComplete.OptInOC,
      signer: algosdk.makeEmptyTransactionSigner(),
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  // ── 1c. Leave DAO (close out, returns stake if applicable) ──────────────

  async buildLeaveDao(): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.leaveDao,
      methodArgs: [],
      sender: this.sender,
      // Extra fee for potential inner payment (stake refund)
      suggestedParams: { ...sp, fee: Math.max(Number(sp.minFee), 2000), flatFee: true },
      onComplete: algosdk.OnApplicationComplete.CloseOutOC,
      signer: algosdk.makeEmptyTransactionSigner(),
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  // ── 2. Whitelist management ─────────────────────────────────────────────

  async buildAddToWhitelist(address: string): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.addToWhitelist,
      methodArgs: [address],
      sender: this.sender,
      suggestedParams: { ...sp, fee: Math.max(Number(sp.minFee), 2000), flatFee: true },
      signer: algosdk.makeEmptyTransactionSigner(),
      boxes: [{ appIndex: Number(this.appId), name: whitelistBoxKey(address) }],
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  async buildRemoveFromWhitelist(address: string): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.removeFromWhitelist,
      methodArgs: [address],
      sender: this.sender,
      suggestedParams: sp,
      signer: algosdk.makeEmptyTransactionSigner(),
      boxes: [{ appIndex: Number(this.appId), name: whitelistBoxKey(address) }],
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  /** Check if an address is on the whitelist by reading its box */
  async isWhitelisted(address: string): Promise<boolean> {
    try {
      const boxKey = whitelistBoxKey(address)
      await this.algodClient.getApplicationBoxByName(Number(this.appId), boxKey).do()
      return true // box exists = whitelisted
    } catch {
      return false
    }
  }

  /** Check if an address has voted on a proposal by reading its vote box */
  async hasVoted(proposalId: bigint, voterAddress: string): Promise<boolean> {
    try {
      const voteBoxKey = new Uint8Array([
        0x76, // "v" prefix
        ...encodeUint64(proposalId),
        ...algosdk.decodeAddress(voterAddress).publicKey,
      ])
      await this.algodClient.getApplicationBoxByName(Number(this.appId), voteBoxKey).do()
      return true // box exists = voted
    } catch {
      return false
    }
  }

  // ── 3. Fund treasury ─────────────────────────────────────────────────────

  async buildFundTreasury(amountMicroAlgos: number): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.sender,
      receiver: this.appAddress,
      amount: amountMicroAlgos,
      suggestedParams: sp,
    })

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.fundTreasury,
      methodArgs: [{ txn: payTxn, signer: algosdk.makeEmptyTransactionSigner() }],
      sender: this.sender,
      suggestedParams: sp,
      signer: algosdk.makeEmptyTransactionSigner(),
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  // ── 4. Create proposal ───────────────────────────────────────────────────

  async buildCreateProposal(
    title: string,
    description: string,
    recipient: string,
    amountMicroAlgos: bigint,
  ): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.createProposal,
      methodArgs: [title, description, recipient, amountMicroAlgos],
      sender: this.sender,
      suggestedParams: { ...sp, fee: Math.max(Number(sp.minFee), 2000), flatFee: true },
      signer: algosdk.makeEmptyTransactionSigner(),
      boxes: [
        {
          appIndex: Number(this.appId),
          name: new Uint8Array([...PROPOSAL_BOX_PREFIX, ...encodeUint64(0n)]),
        },
      ],
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  // ── 5. Vote ──────────────────────────────────────────────────────────────

  async buildVote(proposalId: bigint, voteYes: boolean): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    const proposalBoxKey = new Uint8Array([...PROPOSAL_BOX_PREFIX, ...encodeUint64(proposalId)])
    const voteBoxKey = new Uint8Array([
      0x76, // b"v" prefix
      ...encodeUint64(proposalId),
      ...algosdk.decodeAddress(this.sender).publicKey,
    ])

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.vote,
      methodArgs: [proposalId, voteYes],
      sender: this.sender,
      suggestedParams: { ...sp, fee: Math.max(Number(sp.minFee), 2000), flatFee: true },
      signer: algosdk.makeEmptyTransactionSigner(),
      boxes: [
        { appIndex: Number(this.appId), name: proposalBoxKey },
        { appIndex: Number(this.appId), name: voteBoxKey },
      ],
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  // ── 6. Finalize proposal ─────────────────────────────────────────────────

  async buildFinalizeProposal(proposalId: bigint): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    const proposalBoxKey = new Uint8Array([...PROPOSAL_BOX_PREFIX, ...encodeUint64(proposalId)])
    const proposal = await this.getProposal(proposalId)

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.finalizeProposal,
      methodArgs: [proposalId],
      sender: this.sender,
      suggestedParams: { ...sp, fee: Math.max(Number(sp.minFee), 2000), flatFee: true },
      signer: algosdk.makeEmptyTransactionSigner(),
      boxes: [{ appIndex: Number(this.appId), name: proposalBoxKey }],
      appAccounts: [proposal.recipient],
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  // ── 7. Execute proposal ──────────────────────────────────────────────────

  async buildExecuteProposal(proposalId: bigint, amountMicroAlgos: bigint): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    const proposalBoxKey = new Uint8Array([...PROPOSAL_BOX_PREFIX, ...encodeUint64(proposalId)])
    const proposal = await this.getProposal(proposalId)

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.executeProposal,
      methodArgs: [proposalId, amountMicroAlgos],
      sender: this.sender,
      suggestedParams: { ...sp, fee: Math.max(Number(sp.minFee), 2000), flatFee: true },
      signer: algosdk.makeEmptyTransactionSigner(),
      boxes: [{ appIndex: Number(this.appId), name: proposalBoxKey }],
      appAccounts: [proposal.recipient],
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  // ── 7.5. Delete DAO ───────────────────────────────────────────────────────

  async buildDeleteDao(): Promise<algosdk.Transaction[]> {
    const sp = await this.getSuggestedParams()
    const atc = new algosdk.AtomicTransactionComposer()

    atc.addMethodCall({
      appID: Number(this.appId),
      method: ABI_METHODS.deleteDao,
      methodArgs: [],
      sender: this.sender,
      // Extra fee for inner payment (treasury sweep)
      suggestedParams: { ...sp, fee: Math.max(Number(sp.minFee), 2000), flatFee: true },
      onComplete: algosdk.OnApplicationComplete.DeleteApplicationOC,
      signer: algosdk.makeEmptyTransactionSigner(),
    })

    return atc.buildGroup().map((t) => t.txn)
  }

  // ── 8. Read proposal from box storage ────────────────────────────────────

  async getProposal(proposalId: bigint): Promise<Proposal> {
    const boxKey = new Uint8Array([...PROPOSAL_BOX_PREFIX, ...encodeUint64(proposalId)])
    const boxResponse = await this.algodClient.getApplicationBoxByName(Number(this.appId), boxKey).do()
    const raw = boxResponse.value

    return DaoClient.decodeProposal(raw)
  }

  /**
   * Decode an ARC-4 encoded Proposal struct from raw box bytes.
   */
  static decodeProposal(raw: Uint8Array): Proposal {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.length)

    const titleOffset = view.getUint16(0)
    const descOffset = view.getUint16(2)

    const recipient = algosdk.encodeAddress(raw.slice(4, 36)).toString()
    const amount = decodeUint64(raw, 36)
    const remainingAmount = decodeUint64(raw, 44)
    const yesVotes = decodeUint64(raw, 52)
    const noVotes = decodeUint64(raw, 60)
    const deadline = decodeUint64(raw, 68)

    const boolByte = raw[76]
    const executed = (boolByte & 0x80) !== 0
    const passed = (boolByte & 0x40) !== 0

    const rageQuitDeadline = decodeUint64(raw, 77)

    const [title] = decodeArc4String(raw, titleOffset)
    const [description] = decodeArc4String(raw, descOffset)

    return {
      title,
      description,
      recipient,
      amount,
      remainingAmount,
      yesVotes,
      noVotes,
      deadline,
      executed,
      passed,
      rageQuitDeadline,
    }
  }

  // ── 9. Read global state ─────────────────────────────────────────────────

  async getGlobalState(): Promise<DaoGlobalState> {
    const appInfo = await this.algodClient.getApplicationByID(Number(this.appId)).do()
    const rawState = appInfo as unknown as Record<string, unknown>
    const params = (rawState.params ?? rawState) as Record<string, unknown>
    const globalState = (params.globalState ?? params['global-state']) as Array<{
      key: Uint8Array | string
      value: { type: number; uint: bigint | number; bytes: Uint8Array | string }
    }>

    if (!globalState) {
      throw new Error('Application has no global state')
    }

    const state: Record<string, unknown> = {}
    for (const kv of globalState) {
      const keyBuffer = typeof kv.key === 'string' ? Buffer.from(kv.key, 'base64') : kv.key
      const key = new TextDecoder().decode(keyBuffer)
      if (kv.value.type === 1) {
        state[key] = kv.value.bytes
      } else {
        state[key] = kv.value.uint
      }
    }

    const decodeGlobalString = (bytes: Uint8Array): string => {
      if (!bytes || bytes.length < 2) return ''
      const [str] = decodeArc4String(bytes, 0)
      return str
    }

    // Decode creator address from raw bytes
    let creatorAddr = ''
    if (state['creator']) {
      try {
        const creatorBytes =
          typeof state['creator'] === 'string'
            ? new Uint8Array(Buffer.from(state['creator'] as string, 'base64'))
            : (state['creator'] as Uint8Array)
        if (creatorBytes.length === 32) {
          creatorAddr = algosdk.encodeAddress(creatorBytes).toString()
        }
      } catch {
        // Creator not set
      }
    }

    return {
      daoName: state['dao_name'] instanceof Uint8Array ? decodeGlobalString(state['dao_name']) : '',
      description: state['description'] instanceof Uint8Array ? decodeGlobalString(state['description']) : '',
      quorum: (state['quorum'] as bigint) ?? 0n,
      threshold: (state['threshold'] as bigint) ?? 0n,
      votingDuration: (state['voting_duration'] as bigint) ?? 0n,
      proposalCount: (state['proposal_count'] as bigint) ?? 0n,
      totalMembers: (state['total_members'] as bigint) ?? 0n,
      membershipType: (state['membership_type'] as bigint) ?? 0n,
      minimumStake: (state['minimum_stake'] as bigint) ?? 0n,
      creator: creatorAddr,
    }
  }
}
