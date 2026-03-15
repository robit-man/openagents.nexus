import type { PrivateKey } from '@libp2p/interface';
import { createLogger } from '../logger.js';

const log = createLogger('storage:checkpoint');

export interface RoomCheckpoint {
  schema: 'nexus:room-checkpoint:v1';
  roomId: string;
  epoch: number;
  createdAt: number;
  aggregator: string; // PeerId
  batchCids: string[];
  previousCheckpoint: string | null; // CID
  sig: string;
}

// Create a checkpoint from a set of batch CIDs
export function createCheckpoint(
  roomId: string,
  epoch: number,
  aggregator: string,
  batchCids: string[],
  previousCheckpoint: string | null = null,
): Omit<RoomCheckpoint, 'sig'> {
  return {
    schema: 'nexus:room-checkpoint:v1',
    roomId,
    epoch,
    createdAt: Date.now(),
    aggregator,
    batchCids,
    previousCheckpoint,
  };
}

// Sign a checkpoint
export async function signCheckpoint(
  checkpoint: Omit<RoomCheckpoint, 'sig'>,
  privateKey: PrivateKey,
): Promise<RoomCheckpoint> {
  const payload = JSON.stringify({
    schema: checkpoint.schema,
    roomId: checkpoint.roomId,
    epoch: checkpoint.epoch,
    createdAt: checkpoint.createdAt,
    aggregator: checkpoint.aggregator,
    batchCids: checkpoint.batchCids,
    previousCheckpoint: checkpoint.previousCheckpoint,
  });
  const sigBytes = await privateKey.sign(new TextEncoder().encode(payload));
  return { ...checkpoint, sig: Buffer.from(sigBytes).toString('base64') };
}

// Validate checkpoint structure
export function validateCheckpointStructure(cp: unknown): cp is RoomCheckpoint {
  if (!cp || typeof cp !== 'object') return false;
  const c = cp as Record<string, unknown>;
  if (c.schema !== 'nexus:room-checkpoint:v1') return false;
  if (typeof c.roomId !== 'string') return false;
  if (typeof c.epoch !== 'number') return false;
  if (typeof c.aggregator !== 'string') return false;
  if (!Array.isArray(c.batchCids)) return false;
  if (typeof c.sig !== 'string') return false;
  return true;
}

// Suppress unused variable warning for logger in production code that may grow
void log;
