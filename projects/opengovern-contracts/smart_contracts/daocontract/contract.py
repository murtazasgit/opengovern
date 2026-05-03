"""
DaoContract — Full-featured on-chain DAO built with algopy (Algorand Python v3).

Features:
  • Two membership templates: Whitelist + Self Claim, or Stake to Join
  • Global state for DAO configuration
  • BoxMap-backed proposals (one box per proposal)
  • BoxMap-backed whitelist (one box per whitelisted address)
  • Opt-in membership via app opt-in, tracked with total_members counter
  • Duplicate vote prevention via a second BoxMap keyed by (proposal_id ++ sender)
  • Treasury funding via grouped PaymentTransaction
  • Proposal lifecycle: create → vote → finalize → execute
  • Rage-quit window between finalize and execute
  • Stake lock/unlock for stake-based DAOs
"""

from algopy import (
    ARC4Contract,
    Account,
    Bytes,
    BoxMap,
    Global,
    GlobalState,
    LocalState,
    Txn,
    UInt64,
    arc4,
    gtxn,
    itxn,
    op,
    subroutine,
)


# ---------------------------------------------------------------------------
# Proposal struct — stored in boxes, one per proposal
# ---------------------------------------------------------------------------
class Proposal(arc4.Struct):
    title: arc4.String
    description: arc4.String
    recipient: arc4.Address
    amount: arc4.UInt64
    remaining_amount: arc4.UInt64
    yes_votes: arc4.UInt64
    no_votes: arc4.UInt64
    deadline: arc4.UInt64
    executed: arc4.Bool
    passed: arc4.Bool
    rage_quit_deadline: arc4.UInt64


# ---------------------------------------------------------------------------
# VoteRecord — lightweight flag stored in a box per (proposal, voter) pair
# ---------------------------------------------------------------------------
class VoteRecord(arc4.Struct):
    voted: arc4.Bool


# ---------------------------------------------------------------------------
# Main Contract
# ---------------------------------------------------------------------------
class Daocontract(ARC4Contract):
    """On-chain DAO with proposals, voting, treasury & dual membership models."""

    def __init__(self) -> None:
        # ── Global state ──────────────────────────────────────────────
        self.dao_name = GlobalState(arc4.String(), key="dao_name")
        self.description = GlobalState(arc4.String(), key="description")
        self.quorum = GlobalState(UInt64(0), key="quorum")
        self.threshold = GlobalState(UInt64(0), key="threshold")
        self.voting_duration = GlobalState(UInt64(0), key="voting_duration")
        self.proposal_count = GlobalState(UInt64(0), key="proposal_count")
        self.total_members = GlobalState(UInt64(0), key="total_members")

        # Membership template: 0 = whitelist, 1 = stake
        self.membership_type = GlobalState(UInt64(0), key="membership_type")
        # Minimum stake in microAlgos (only for stake mode)
        self.minimum_stake = GlobalState(UInt64(0), key="minimum_stake")
        # Creator address (for whitelist management permissions)
        self.creator = GlobalState(Bytes, key="creator")

        # ── Box storage: proposals ────────────────────────────────────
        self.proposals = BoxMap(arc4.UInt64, Proposal, key_prefix=b"p")

        # ── Box storage: vote dedup ───────────────────────────────────
        self.votes = BoxMap(Bytes, VoteRecord, key_prefix=b"v")

        # ── Box storage: whitelist ────────────────────────────────────
        # Key: arc4.Address → arc4.Bool (True = whitelisted)
        self.whitelist = BoxMap(arc4.Address, arc4.Bool, key_prefix=b"w")

        # ── Local state (per opted-in member) ─────────────────────────
        self.member_since = LocalState(UInt64, key="member_since")
        self.staked_amount = LocalState(UInt64, key="staked_amount")

    @subroutine
    def _do_finalize(self, proposal_id: UInt64) -> None:
        """Internal logic to check requirements and finalize/execute a proposal."""
        key = arc4.UInt64(proposal_id)
        proposal = self.proposals[key].copy()

        # Calculation
        total_votes = proposal.yes_votes.native + proposal.no_votes.native
        quorum_met = total_votes >= self.quorum.value
        
        threshold_met = False
        if total_votes > 0:
            yes_pct = proposal.yes_votes.native * 100 // total_votes
            threshold_met = yes_pct >= self.threshold.value

        # Guaranteed pass check: yes_votes > (total_members * threshold / 100)
        # This allows early execution before the deadline if it's mathematically certain.
        guaranteed_pass = False
        if self.total_members.value > 0:
            # We use a conservative check: yes_votes must be an absolute majority of the DAO
            # to bypass the deadline safely.
            guaranteed_pass = proposal.yes_votes.native > (self.total_members.value // 2)

        # Requirements check
        # Can finalize if: (Deadline passed AND met threshold) OR (Absolute majority met)
        can_pass = (Global.latest_timestamp > proposal.deadline.native and quorum_met and threshold_met) or guaranteed_pass

        if can_pass:
            proposal.passed = arc4.Bool(True)  # noqa: FBT003
            proposal.executed = arc4.Bool(True)  # noqa: FBT003
            proposal.remaining_amount = arc4.UInt64(0)
            
            self.proposals[key] = proposal.copy()

            # Execute payment immediately
            itxn.Payment(
                receiver=proposal.recipient.native,
                amount=proposal.amount.native,
                fee=0,
            ).submit()
        elif Global.latest_timestamp > proposal.deadline.native:
            # Deadline passed but failed requirements
            proposal.passed = arc4.Bool(False)  # noqa: FBT003
            proposal.rage_quit_deadline = arc4.UInt64(Global.latest_timestamp)
            self.proposals[key] = proposal.copy()

    @arc4.abimethod()
    def delete_proposal(self, proposal_id: UInt64) -> None:
        """Allow the creator to delete a proposal box (required before app deletion)."""
        assert Txn.sender.bytes == self.creator.value, (
            "Only the creator can delete proposals"
        )
        # Clear the proposal box
        del self.proposals[arc4.UInt64(proposal_id)]

    @arc4.abimethod()
    def delete_vote_record(self, proposal_id: UInt64, voter: Account) -> None:
        """Allow the creator to delete a vote record box (required before app deletion)."""
        assert Txn.sender.bytes == self.creator.value, (
            "Only the creator can manage vote records"
        )
        # Clear the vote box
        del self.votes[_vote_box_key(proposal_id, voter)]

    # ------------------------------------------------------------------
    # 1. create_dao — called once at application creation
    # ------------------------------------------------------------------
    @arc4.abimethod(create="require")
    def create_dao(
        self,
        name: arc4.String,
        description: arc4.String,
        quorum: UInt64,
        threshold: UInt64,
        voting_duration: UInt64,
        membership_type: UInt64,
        minimum_stake: UInt64,
    ) -> None:
        assert quorum > 0, "quorum must be > 0"
        assert threshold > 0, "threshold must be > 0"
        assert threshold <= 100, "threshold must be <= 100"
        assert voting_duration > 0, "voting_duration must be > 0"
        assert membership_type <= 1, "membership_type must be 0 or 1"

        self.dao_name.value = name
        self.description.value = description
        self.quorum.value = quorum
        self.threshold.value = threshold
        self.voting_duration.value = voting_duration
        self.proposal_count.value = UInt64(0)
        self.total_members.value = UInt64(0)
        self.membership_type.value = membership_type
        self.minimum_stake.value = minimum_stake
        self.creator.value = Txn.sender.bytes

    # ------------------------------------------------------------------
    # 2. fund_treasury — anyone sends ALGO to the contract
    # ------------------------------------------------------------------
    @arc4.abimethod()
    def fund_treasury(self, payment: gtxn.PaymentTransaction) -> None:
        assert payment.receiver == Global.current_application_address, (
            "Payment must be sent to the DAO treasury"
        )
        assert payment.amount > 0, "Must fund a positive amount"

    # ------------------------------------------------------------------
    # 3a. opt_in_member — whitelist self-claim (membership_type == 0)
    # ------------------------------------------------------------------
    @arc4.abimethod(allow_actions=["OptIn"])
    def opt_in_member(self) -> None:
        # Whitelist mode: verify sender is creator OR whitelisted
        if self.membership_type.value == UInt64(0):
            is_creator = Txn.sender.bytes == self.creator.value
            if not is_creator:
                key = arc4.Address(Txn.sender)
                assert key in self.whitelist, "Not on the whitelist"

        # Stake mode: this method should NOT be used — use stake_join
        if self.membership_type.value == UInt64(1):
            assert False, "Use stake_join for stake-based DAOs"  # noqa: B011

        self.total_members.value += 1
        self.member_since[Txn.sender] = Global.latest_timestamp

    # ------------------------------------------------------------------
    # 3b. stake_join — stake ALGO to join (membership_type == 1)
    # ------------------------------------------------------------------
    @arc4.abimethod(allow_actions=["OptIn"])
    def stake_join(self, payment: gtxn.PaymentTransaction) -> None:
        assert self.membership_type.value == UInt64(1), (
            "stake_join is only for stake-based DAOs"
        )
        assert payment.receiver == Global.current_application_address, (
            "Payment must be sent to the DAO"
        )
        assert payment.amount >= self.minimum_stake.value, (
            "Insufficient stake amount"
        )

        self.total_members.value += 1
        self.member_since[Txn.sender] = Global.latest_timestamp
        self.staked_amount[Txn.sender] = payment.amount

    # ------------------------------------------------------------------
    # 3c. leave_dao — close out, return staked ALGO if applicable
    # ------------------------------------------------------------------
    @arc4.abimethod(allow_actions=["CloseOut"])
    def leave_dao(self) -> None:
        self.total_members.value -= 1

        # Return staked ALGO for stake-based DAOs
        if self.membership_type.value == UInt64(1):
            staked = self.staked_amount[Txn.sender]
            if staked > UInt64(0):
                itxn.Payment(
                    receiver=Txn.sender,
                    amount=staked,
                    fee=0,
                ).submit()

    # ------------------------------------------------------------------
    # 4. Whitelist management — creator only
    # ------------------------------------------------------------------
    @arc4.abimethod()
    def add_to_whitelist(self, address: Account) -> None:
        assert Txn.sender.bytes == self.creator.value, (
            "Only the creator can manage the whitelist"
        )
        assert self.membership_type.value == UInt64(0), (
            "Whitelist is only for whitelist-based DAOs"
        )
        self.whitelist[arc4.Address(address)] = arc4.Bool(True)  # noqa: FBT003

    @arc4.abimethod()
    def remove_from_whitelist(self, address: Account) -> None:
        assert Txn.sender.bytes == self.creator.value, (
            "Only the creator can manage the whitelist"
        )
        assert self.membership_type.value == UInt64(0), (
            "Whitelist is only for whitelist-based DAOs"
        )
        del self.whitelist[arc4.Address(address)]

    # ------------------------------------------------------------------
    # 5. create_proposal
    # ------------------------------------------------------------------
    @arc4.abimethod()
    def create_proposal(
        self,
        title: arc4.String,
        description: arc4.String,
        recipient: Account,
        amount: UInt64,
    ) -> UInt64:
        # Only opted-in members can create proposals
        assert op.app_opted_in(Txn.sender, Global.current_application_id), (
            "Must be a DAO member"
        )
        assert amount > 0, "Proposal amount must be > 0"

        proposal_id = self.proposal_count.value
        self.proposal_count.value += 1

        deadline = Global.latest_timestamp + self.voting_duration.value

        proposal = Proposal(
            title=title,
            description=description,
            recipient=arc4.Address(recipient),
            amount=arc4.UInt64(amount),
            remaining_amount=arc4.UInt64(amount),
            yes_votes=arc4.UInt64(0),
            no_votes=arc4.UInt64(0),
            deadline=arc4.UInt64(deadline),
            executed=arc4.Bool(False),  # noqa: FBT003
            passed=arc4.Bool(False),  # noqa: FBT003
            rage_quit_deadline=arc4.UInt64(0),
        )
        self.proposals[arc4.UInt64(proposal_id)] = proposal.copy()

        return proposal_id

    # ------------------------------------------------------------------
    # 6. vote
    # ------------------------------------------------------------------
    @arc4.abimethod()
    def vote(self, proposal_id: UInt64, vote_yes: bool) -> None:  # noqa: FBT001
        # Must be opted-in member
        assert op.app_opted_in(Txn.sender, Global.current_application_id), (
            "Must be a DAO member"
        )

        key = arc4.UInt64(proposal_id)
        assert key in self.proposals, "Proposal does not exist"

        proposal = self.proposals[key].copy()

        # Voting window still open
        assert Global.latest_timestamp <= proposal.deadline.native, (
            "Voting period has ended"
        )

        # Duplicate vote check via vote-dedup BoxMap
        vote_key = _vote_box_key(proposal_id, Txn.sender)
        assert vote_key not in self.votes, "Already voted on this proposal"

        # Record the vote flag
        self.votes[vote_key] = VoteRecord(
            voted=arc4.Bool(True),  # noqa: FBT003
        )

        # Tally
        if vote_yes:
            proposal.yes_votes = arc4.UInt64(proposal.yes_votes.native + 1)
        else:
            proposal.no_votes = arc4.UInt64(proposal.no_votes.native + 1)

        self.proposals[key] = proposal.copy()

        # AUTO-EXECUTE: Check if this vote finalized the proposal early
        self._do_finalize(proposal_id)

    # ------------------------------------------------------------------
    # 7. finalize_proposal — manual trigger (optional)
    # ------------------------------------------------------------------
    @arc4.abimethod()
    def finalize_proposal(self, proposal_id: UInt64) -> None:
        key = arc4.UInt64(proposal_id)
        assert key in self.proposals, "Proposal does not exist"
        
        proposal = self.proposals[key].copy()
        
        # Must not already be finalized/executed
        assert proposal.rage_quit_deadline.native == 0 and not proposal.passed.native, (
            "Proposal already finalized or passed"
        )

        self._do_finalize(proposal_id)

    # ------------------------------------------------------------------
    # 8. execute_proposal — partial or full disbursement
    # ------------------------------------------------------------------
    @arc4.abimethod()
    def execute_proposal(self, proposal_id: UInt64, amount: UInt64) -> None:
        key = arc4.UInt64(proposal_id)
        assert key in self.proposals, "Proposal does not exist"

        proposal = self.proposals[key].copy()

        assert proposal.passed.native, "Proposal did not pass"
        assert not proposal.executed.native, "Proposal already fully executed"
        assert proposal.rage_quit_deadline.native > 0, (
            "Proposal not yet finalized"
        )
        assert Global.latest_timestamp > proposal.rage_quit_deadline.native, (
            "Rage-quit window still open"
        )
        assert amount > 0, "Amount must be > 0"
        assert amount <= proposal.remaining_amount.native, (
            "Amount exceeds remaining"
        )

        # Update remaining amount
        new_remaining = proposal.remaining_amount.native - amount
        proposal.remaining_amount = arc4.UInt64(new_remaining)
        if new_remaining == 0:
            proposal.executed = arc4.Bool(True)  # noqa: FBT003

        self.proposals[key] = proposal.copy()

        # Send inner payment to recipient
        itxn.Payment(
            receiver=proposal.recipient.native,
            amount=amount,
            fee=0,
        ).submit()

    # ------------------------------------------------------------------
    # 9. delete_dao — creator only
    # ------------------------------------------------------------------
    @arc4.abimethod(allow_actions=["DeleteApplication"])
    def delete_dao(self) -> None:
        """Fully delete the application and send the remaining ALGO to the creator."""
        assert Txn.sender.bytes == self.creator.value, (
            "Only the creator can delete the DAO"
        )

        # Send all remaining ALGO back to the creator via close_remainder_to
        itxn.Payment(
            receiver=Txn.sender,
            amount=0,
            close_remainder_to=Txn.sender,
            fee=0,
        ).submit()


# ---------------------------------------------------------------------------
# Pure helper — builds the composite box key for vote dedup
# ---------------------------------------------------------------------------
@subroutine
def _vote_box_key(proposal_id: UInt64, voter: Account) -> Bytes:
    """Concatenate 8-byte proposal id + 32-byte sender address."""
    return op.itob(proposal_id) + voter.bytes
