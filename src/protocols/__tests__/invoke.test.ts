/**
 * Tests for the /nexus/invoke/1.1.0 streaming capability invocation protocol.
 *
 * Coverage targets:
 *   - INVOKE_PROTOCOL constant value
 *   - encodeStreamMessage / decodeStreamMessage round-trip for every message type
 *   - Message shape validation (required fields present, correct type discriminant)
 *   - decodeStreamMessage handles empty/whitespace-only input gracefully
 *   - decodeStreamMessage handles malformed JSON gracefully
 */

import { describe, it, expect } from 'vitest';
import {
  INVOKE_PROTOCOL,
  encodeStreamMessage,
  decodeStreamMessage,
  type InvokeOpen,
  type InvokeChunk,
  type InvokeAccept,
  type InvokeEvent,
  type InvokeDone,
  type InvokeError,
  type InvokeCancel,
  type InvokeMessage,
} from '../invoke.js';

// ---------------------------------------------------------------------------
// Protocol constant
// ---------------------------------------------------------------------------

describe('INVOKE_PROTOCOL', () => {
  it('has the correct protocol identifier', () => {
    expect(INVOKE_PROTOCOL).toBe('/nexus/invoke/1.1.0');
  });
});

// ---------------------------------------------------------------------------
// encodeStreamMessage / decodeStreamMessage round-trip
// ---------------------------------------------------------------------------

describe('encodeStreamMessage / decodeStreamMessage — round-trip', () => {
  function roundTrip(msg: InvokeMessage): InvokeMessage | null {
    return decodeStreamMessage(encodeStreamMessage(msg));
  }

  it('round-trips an InvokeOpen message', () => {
    const msg: InvokeOpen = {
      type: 'invoke.open',
      version: 1,
      requestId: 'req-001',
      capability: 'text.summarize',
      inputFormat: 'text/plain',
      outputMode: 'stream',
      maxDurationMs: 30_000,
      maxInputBytes: 65_536,
      maxOutputBytes: 131_072,
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('round-trips an InvokeChunk message', () => {
    const msg: InvokeChunk = {
      type: 'invoke.chunk',
      version: 1,
      requestId: 'req-001',
      seq: 0,
      isFinalInput: true,
      data: { text: 'Hello, world!' },
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('round-trips an InvokeAccept message (accepted=true)', () => {
    const msg: InvokeAccept = {
      type: 'invoke.accept',
      version: 1,
      requestId: 'req-001',
      accepted: true,
      estimatedStartMs: 100,
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('round-trips an InvokeAccept message without estimatedStartMs', () => {
    const msg: InvokeAccept = {
      type: 'invoke.accept',
      version: 1,
      requestId: 'req-001',
      accepted: false,
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('round-trips an InvokeEvent message', () => {
    const msg: InvokeEvent = {
      type: 'invoke.event',
      version: 1,
      requestId: 'req-001',
      seq: 3,
      event: 'token',
      data: 'Hello',
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('round-trips an InvokeDone message with usage', () => {
    const msg: InvokeDone = {
      type: 'invoke.done',
      version: 1,
      requestId: 'req-001',
      usage: { inputBytes: 128, outputBytes: 512 },
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('round-trips an InvokeDone message without usage', () => {
    const msg: InvokeDone = {
      type: 'invoke.done',
      version: 1,
      requestId: 'req-001',
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('round-trips an InvokeError message', () => {
    const msg: InvokeError = {
      type: 'invoke.error',
      version: 1,
      requestId: 'req-001',
      code: 'CAPABILITY_NOT_FOUND',
      message: 'No handler registered for text.summarize',
    };
    expect(roundTrip(msg)).toEqual(msg);
  });

  it('round-trips an InvokeCancel message', () => {
    const msg: InvokeCancel = {
      type: 'invoke.cancel',
      version: 1,
      requestId: 'req-001',
      reason: 'user_cancelled',
    };
    expect(roundTrip(msg)).toEqual(msg);
  });
});

// ---------------------------------------------------------------------------
// encodeStreamMessage output format
// ---------------------------------------------------------------------------

describe('encodeStreamMessage — output format', () => {
  it('encodes to a Uint8Array', () => {
    const msg: InvokeCancel = {
      type: 'invoke.cancel',
      version: 1,
      requestId: 'req-x',
      reason: 'timeout',
    };
    const encoded = encodeStreamMessage(msg);
    expect(encoded).toBeInstanceOf(Uint8Array);
  });

  it('encoded bytes decode to valid UTF-8 JSON ending with newline', () => {
    const msg: InvokeCancel = {
      type: 'invoke.cancel',
      version: 1,
      requestId: 'req-x',
      reason: 'timeout',
    };
    const encoded = encodeStreamMessage(msg);
    const text = new TextDecoder().decode(encoded);
    expect(text.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(text.trim())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// decodeStreamMessage — edge cases
// ---------------------------------------------------------------------------

describe('decodeStreamMessage — edge cases', () => {
  it('returns null for empty Uint8Array', () => {
    expect(decodeStreamMessage(new Uint8Array(0))).toBeNull();
  });

  it('returns null for whitespace-only bytes', () => {
    const ws = new TextEncoder().encode('   \n  ');
    expect(decodeStreamMessage(ws)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const bad = new TextEncoder().encode('{not valid json}');
    expect(decodeStreamMessage(bad)).toBeNull();
  });

  it('preserves the type discriminant after round-trip', () => {
    const types: Array<InvokeMessage['type']> = [
      'invoke.open',
      'invoke.chunk',
      'invoke.accept',
      'invoke.event',
      'invoke.done',
      'invoke.error',
      'invoke.cancel',
    ];

    // Build minimal messages for each discriminant and verify type survives
    const messages: InvokeMessage[] = [
      { type: 'invoke.open', version: 1, requestId: 'r', capability: 'c', inputFormat: 'text/plain', outputMode: 'unary', maxDurationMs: 1000, maxInputBytes: 1024, maxOutputBytes: 1024 },
      { type: 'invoke.chunk', version: 1, requestId: 'r', seq: 0, isFinalInput: true, data: null },
      { type: 'invoke.accept', version: 1, requestId: 'r', accepted: true },
      { type: 'invoke.event', version: 1, requestId: 'r', seq: 0, event: 'progress', data: 50 },
      { type: 'invoke.done', version: 1, requestId: 'r' },
      { type: 'invoke.error', version: 1, requestId: 'r', code: 'ERR', message: 'fail' },
      { type: 'invoke.cancel', version: 1, requestId: 'r', reason: 'abort' },
    ];

    messages.forEach((msg, i) => {
      const decoded = decodeStreamMessage(encodeStreamMessage(msg));
      expect(decoded?.type).toBe(types[i]);
    });
  });
});

// ---------------------------------------------------------------------------
// Message type construction (shape assertions)
// ---------------------------------------------------------------------------

describe('InvokeOpen — shape', () => {
  it('requires outputMode to be stream or unary', () => {
    const streamMsg: InvokeOpen = {
      type: 'invoke.open',
      version: 1,
      requestId: 'req-002',
      capability: 'image.generate',
      inputFormat: 'application/json',
      outputMode: 'stream',
      maxDurationMs: 60_000,
      maxInputBytes: 4_096,
      maxOutputBytes: 1_048_576,
    };
    expect(streamMsg.outputMode).toBe('stream');

    const unaryMsg: InvokeOpen = { ...streamMsg, outputMode: 'unary' };
    expect(unaryMsg.outputMode).toBe('unary');
  });
});

describe('InvokeCancel — shape', () => {
  it('has the expected fields', () => {
    const cancel: InvokeCancel = {
      type: 'invoke.cancel',
      version: 1,
      requestId: 'req-cancel',
      reason: 'client_disconnected',
    };
    expect(cancel.type).toBe('invoke.cancel');
    expect(cancel.version).toBe(1);
    expect(cancel.requestId).toBe('req-cancel');
    expect(cancel.reason).toBe('client_disconnected');
  });
});
