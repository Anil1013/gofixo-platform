const INITIAL_STATUS_BY_DIRECTION = Object.freeze({
  in: 'pending_verification',
  out: 'payout_pending',
});

function validateInitialStatus(direction, status) {
  const expected = INITIAL_STATUS_BY_DIRECTION[direction];
  if (!expected) return 'direction must be in or out';
  if (status !== expected) {
    return direction === 'in'
      ? 'Incoming payments must start as pending_verification and be verified after matching the bank statement'
      : 'Outgoing payments must start as payout_pending and be marked paid only after the bank transfer is confirmed';
  }
  return null;
}

function validateStatusTransition({ direction, currentStatus, nextStatus, bankReference }) {
  if (!['in', 'out'].includes(direction)) return 'Invalid transaction direction';
  if (currentStatus === nextStatus) return null;

  const transitions = direction === 'in'
    ? {
        pending_verification: new Set(['verified', 'failed', 'refunded']),
        verified: new Set(['refunded']),
      }
    : {
        payout_pending: new Set(['paid', 'failed']),
        failed: new Set(['payout_pending']),
        paid: new Set(['refunded']),
      };

  if (!transitions[currentStatus]?.has(nextStatus)) {
    return direction === 'in'
      ? 'Incoming payment can only move from pending_verification to verified, failed or refunded'
      : 'Outgoing payment can only move from payout_pending to paid or failed; failed payouts may be retried';
  }

  if (nextStatus === 'verified' && direction !== 'in') {
    return 'Only incoming payments can be verified';
  }
  if (nextStatus === 'paid' && direction !== 'out') {
    return 'Only outgoing transfers can be marked paid';
  }
  if (['verified', 'paid', 'refunded'].includes(nextStatus) && !String(bankReference || '').trim()) {
    return 'A bank statement reference is required before confirming this transaction status';
  }
  return null;
}

module.exports = { validateInitialStatus, validateStatusTransition };
