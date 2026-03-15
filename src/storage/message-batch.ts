import type { PrivateKey } from '@libp2p/interface';
import { uuidv7 } from '../protocol/index.js';
import { createLogger } from '../logger.js';

const log = createLogger('storage:batch');

export interface BatchMessage {
  id: string;
  timestamp: number;
  sender: string;
  format: string;
  content: string;
}

export interface MessageBatch {
  schema: 'nexus:message-batch:v1';
  roomId: string;
  batchId: string;
  author: string; // PeerId of batch creator
  createdAt: number;
  messages: BatchMessage[];
  retentionClass: 'ephemeral' | 'cache' | 'retained' | 'mirrored' | 'archival';
  sig: string;
}

export const MAX_BATCH_SIZE = 100;

// Create a new message batch from accumulated messages
export function createBatch(
  roomId: string,
  author: string,
  messages: BatchMessage[],
  retentionClass: MessageBatch['retentionClass'] = 'cache',
): Omit<MessageBatch, 'sig'> {
  return {
    schema: 'nexus:message-batch:v1',
    roomId,
    batchId: uuidv7(),
    author,
    createdAt: Date.now(),
    messages: messages.slice(0, MAX_BATCH_SIZE),
    retentionClass,
  };
}

// Sign a batch
export async function signBatch(
  batch: Omit<MessageBatch, 'sig'>,
  privateKey: PrivateKey,
): Promise<MessageBatch> {
  const payload = JSON.stringify({
    schema: batch.schema,
    roomId: batch.roomId,
    batchId: batch.batchId,
    author: batch.author,
    createdAt: batch.createdAt,
    messages: batch.messages,
    retentionClass: batch.retentionClass,
  });
  const sigBytes = await privateKey.sign(new TextEncoder().encode(payload));
  return { ...batch, sig: Buffer.from(sigBytes).toString('base64') };
}

// Validate a batch structure (not signature — that requires the author's public key)
export function validateBatchStructure(batch: unknown): batch is MessageBatch {
  if (!batch || typeof batch !== 'object') return false;
  const b = batch as Record<string, unknown>;
  if (b.schema !== 'nexus:message-batch:v1') return false;
  if (typeof b.roomId !== 'string') return false;
  if (typeof b.batchId !== 'string') return false;
  if (typeof b.author !== 'string') return false;
  if (!Array.isArray(b.messages)) return false;
  if (b.messages.length > MAX_BATCH_SIZE) return false;
  if (typeof b.sig !== 'string') return false;
  return true;
}

// Suppress unused variable warning for logger in production code that may grow
void log;
