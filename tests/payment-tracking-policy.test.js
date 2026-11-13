const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInitialStatus, validateStatusTransition } = require('../services/payment-tracking-policy');

test('incoming payment claims always begin unverified', () => {
  assert.equal(validateInitialStatus('in', 'pending_verification'), null);
  assert.match(validateInitialStatus('in', 'verified'), /must start as pending_verification/);
  assert.match(validateInitialStatus('in', 'paid'), /must start as pending_verification/);
});

test('outgoing payout records begin pending and cannot be created as paid', () => {
  assert.equal(validateInitialStatus('out', 'payout_pending'), null);
  assert.match(validateInitialStatus('out', 'paid'), /must start as payout_pending/);
  assert.match(validateInitialStatus('other', 'paid'), /direction must be in or out/);
});

test('incoming payment verification requires bank reference', () => {
  assert.match(validateStatusTransition({
    direction: 'in', currentStatus: 'pending_verification', nextStatus: 'verified', bankReference: ''
  }), /bank statement reference is required/);
  assert.equal(validateStatusTransition({
    direction: 'in', currentStatus: 'pending_verification', nextStatus: 'verified', bankReference: 'UTR-123'
  }), null);
});

test('outgoing payout cannot be marked paid without transfer reference', () => {
  assert.match(validateStatusTransition({
    direction: 'out', currentStatus: 'payout_pending', nextStatus: 'paid', bankReference: ''
  }), /bank statement reference is required/);
  assert.equal(validateStatusTransition({
    direction: 'out', currentStatus: 'payout_pending', nextStatus: 'paid', bankReference: 'NEFT-123'
  }), null);
});

test('direction-specific payment states cannot be crossed or bypassed', () => {
  assert.match(validateStatusTransition({
    direction: 'in', currentStatus: 'pending_verification', nextStatus: 'paid', bankReference: 'REF'
  }), /Incoming payment can only move/);
  assert.match(validateStatusTransition({
    direction: 'out', currentStatus: 'payout_pending', nextStatus: 'verified', bankReference: 'REF'
  }), /Outgoing payment can only move/);
  assert.match(validateStatusTransition({
    direction: 'out', currentStatus: 'paid', nextStatus: 'payout_pending', bankReference: 'REF'
  }), /Outgoing payment can only move/);
});

test('failed outgoing payout can be retried but cannot skip bank confirmation', () => {
  assert.equal(validateStatusTransition({
    direction: 'out', currentStatus: 'failed', nextStatus: 'payout_pending', bankReference: ''
  }), null);
  assert.equal(validateStatusTransition({
    direction: 'in', currentStatus: 'pending_verification', nextStatus: 'failed', bankReference: ''
  }), null);
});
