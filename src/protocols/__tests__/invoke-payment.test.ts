/**
 * Tests for invoke payment types (InvokePaymentRequired, InvokePaymentProof)
 */

import { describe, it, expect } from 'vitest';
import {
  encodeStreamMessage,
  decodeStreamMessage,
  type InvokePaymentRequired,
  type InvokePaymentProof,
} from '../invoke.js';

describe('Invoke payment message types', () => {
  it('encodes and decodes InvokePaymentRequired', () => {
    const msg: InvokePaymentRequired = {
      type: 'invoke.payment_required',
      version: 1,
      requestId: 'req-123',
      terms: {
        amount: '0.001',
        currency: 'USDC',
        recipient: '0x1234567890abcdef1234567890abcdef12345678',
        description: 'Translation service',
        validUntil: Date.now() + 60_000,
      },
    };

    const encoded = encodeStreamMessage(msg);
    const decoded = decodeStreamMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it('encodes and decodes InvokePaymentProof', () => {
    const msg: InvokePaymentProof = {
      type: 'invoke.payment_proof',
      version: 1,
      requestId: 'req-123',
      proof: {
        from: '0xaaaa',
        to: '0xbbbb',
        amount: '0.001',
        currency: 'USDC',
        signature: '0xsig',
        nonce: '0xnonce',
        validAfter: Date.now() - 1000,
        validBefore: Date.now() + 60_000,
      },
    };

    const encoded = encodeStreamMessage(msg);
    const decoded = decodeStreamMessage(encoded);
    expect(decoded).toEqual(msg);
  });

  it('InvokePaymentRequired round-trips with minimal terms', () => {
    const msg: InvokePaymentRequired = {
      type: 'invoke.payment_required',
      version: 1,
      requestId: 'req-456',
      terms: {
        amount: '0.01',
        currency: 'USDC',
        recipient: '0xrecipient',
      },
    };

    const decoded = decodeStreamMessage(encodeStreamMessage(msg));
    expect(decoded?.type).toBe('invoke.payment_required');
    expect((decoded as InvokePaymentRequired).terms.amount).toBe('0.01');
  });
});
