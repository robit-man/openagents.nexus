/**
 * /nexus/invoke/1.1.0 — Streaming capability invocation protocol
 *
 * Enables streaming capability invocation between agents with cancel support.
 * The protocol works as a bidirectional stream using newline-delimited JSON.
 *
 * Protocol flow:
 *   Requester → invoke.open
 *   Provider  → invoke.accept | invoke.error
 *   Requester → invoke.chunk (one or more)
 *   Provider  → invoke.event (streaming output tokens/progress)
 *   Provider  → invoke.done (completion)
 *   Either    → invoke.cancel (at any time)
 */

import { createLogger } from '../logger.js';

const log = createLogger('protocol:invoke');

export const INVOKE_PROTOCOL = '/nexus/invoke/1.1.0';

// ---------------------------------------------------------------------------
// Message type interfaces
// ---------------------------------------------------------------------------

export interface InvokeOpen {
  type: 'invoke.open';
  version: 1;
  requestId: string;
  capability: string;
  inputFormat: string;
  outputMode: 'stream' | 'unary';
  maxDurationMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
}

export interface InvokeChunk {
  type: 'invoke.chunk';
  version: 1;
  requestId: string;
  seq: number;
  isFinalInput: boolean;
  data: unknown;
}

export interface InvokeAccept {
  type: 'invoke.accept';
  version: 1;
  requestId: string;
  accepted: boolean;
  estimatedStartMs?: number;
}

export interface InvokeEvent {
  type: 'invoke.event';
  version: 1;
  requestId: string;
  seq: number;
  event: string; // 'token', 'progress', 'partial', etc.
  data: unknown;
}

export interface InvokeDone {
  type: 'invoke.done';
  version: 1;
  requestId: string;
  usage?: { inputBytes: number; outputBytes: number };
}

export interface InvokeError {
  type: 'invoke.error';
  version: 1;
  requestId: string;
  code: string;
  message: string;
}

export interface InvokeCancel {
  type: 'invoke.cancel';
  version: 1;
  requestId: string;
  reason: string;
}

export interface InvokePaymentRequired {
  type: 'invoke.payment_required';
  version: 1;
  requestId: string;
  terms: {
    amount: string;
    currency: string;
    recipient: string;
    description?: string;
    validUntil?: number;
  };
}

export interface InvokePaymentProof {
  type: 'invoke.payment_proof';
  version: 1;
  requestId: string;
  proof: {
    from: string;
    to: string;
    amount: string;
    currency: string;
    signature: string;
    nonce: string;
    validAfter: number;
    validBefore: number;
  };
}

export type InvokeMessage =
  | InvokeOpen
  | InvokeChunk
  | InvokeAccept
  | InvokeEvent
  | InvokeDone
  | InvokeError
  | InvokeCancel
  | InvokePaymentRequired
  | InvokePaymentProof;

// ---------------------------------------------------------------------------
// Codec helpers
// ---------------------------------------------------------------------------

/**
 * Encode an InvokeMessage for writing to a libp2p stream.
 * Each message is a JSON object followed by a newline (NDJSON).
 */
export function encodeStreamMessage(msg: InvokeMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg) + '\n');
}

/**
 * Decode an InvokeMessage from stream data.
 * Returns null if the data is empty, whitespace-only, or unparseable.
 */
export function decodeStreamMessage(data: Uint8Array): InvokeMessage | null {
  try {
    const text = new TextDecoder().decode(data).trim();
    if (!text) return null;
    return JSON.parse(text) as InvokeMessage;
  } catch {
    log.debug('decodeStreamMessage: failed to parse message');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider-side handler type
// ---------------------------------------------------------------------------

/**
 * Stream abstraction passed to an InvokeHandler.
 * Providers write response messages and read further input from the requester.
 */
export interface InvokeStreamHandle {
  write: (msg: InvokeMessage) => Promise<void>;
  onData: (cb: (msg: InvokeMessage) => void) => void;
  close: () => void;
}

/**
 * Provider-side handler: receives the initial InvokeOpen message and a
 * stream handle, then drives the protocol from the provider side.
 */
export type InvokeHandler = (
  request: InvokeOpen,
  stream: InvokeStreamHandle,
) => Promise<void>;
