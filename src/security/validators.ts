import type { AgentProfile, RoomManifest, NexusMessage } from '../protocol/types.js';

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 512;
const MAX_CAPABILITY_COUNT = 32;
const MAX_TRANSPORT_COUNT = 16;

export function validateAgentProfile(data: unknown): AgentProfile | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  if (obj.schema !== 'nexus:agent-profile:v1') return null;
  if (typeof obj.peerId !== 'string' || obj.peerId.length === 0 || obj.peerId.length > 128) return null;
  if (typeof obj.name !== 'string' || obj.name.length > MAX_NAME_LENGTH) return null;
  if (typeof obj.role !== 'string') return null;
  if (!['light', 'full', 'storage'].includes(obj.role as string)) return null;
  if (!Array.isArray(obj.capabilities) || obj.capabilities.length > MAX_CAPABILITY_COUNT) return null;
  if (!Array.isArray(obj.transports) || obj.transports.length > MAX_TRANSPORT_COUNT) return null;
  if (typeof obj.createdAt !== 'number') return null;
  if (typeof obj.updatedAt !== 'number') return null;

  return data as AgentProfile;
}

export function validateRoomManifest(data: unknown): RoomManifest | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  if (obj.schema !== 'nexus:room-manifest:v1') return null;
  if (typeof obj.roomId !== 'string' || obj.roomId.length === 0 || obj.roomId.length > 64) return null;
  if (typeof obj.name !== 'string' || obj.name.length > MAX_NAME_LENGTH) return null;
  if (typeof obj.topic !== 'string') return null;
  if (!['persistent', 'ephemeral'].includes(obj.type as string)) return null;
  if (typeof obj.createdAt !== 'number') return null;

  return data as RoomManifest;
}

export function validateNexusMessage(data: unknown): NexusMessage | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) return null;
  if (typeof obj.type !== 'string') return null;
  if (!['chat', 'presence', 'meta', 'capability', 'sync'].includes(obj.type as string)) return null;
  if (typeof obj.id !== 'string' || obj.id.length === 0 || obj.id.length > 64) return null;
  if (typeof obj.timestamp !== 'number') return null;
  if (typeof obj.sender !== 'string' || obj.sender.length === 0 || obj.sender.length > 128) return null;
  if (typeof obj.topic !== 'string') return null;
  if (!obj.payload || typeof obj.payload !== 'object') return null;

  // Validate references array
  if (obj.references !== undefined) {
    if (!Array.isArray(obj.references)) return null;
    if (obj.references.length > 8) return null; // MAX_REFS_PER_MESSAGE
    for (const ref of obj.references) {
      if (typeof ref !== 'string' || ref.length === 0 || ref.length > 128) return null;
    }
  }

  return data as NexusMessage;
}

// Validate a CID string format (basic check, not cryptographic verification)
export function isValidCid(cid: string): boolean {
  if (typeof cid !== 'string') return false;
  if (cid.length === 0 || cid.length > 128) return false;
  // CIDv0 starts with Qm, CIDv1 starts with baf or z
  return cid.startsWith('Qm') || cid.startsWith('baf') || cid.startsWith('b') || cid.startsWith('z');
}

// Sanitize a name string for safe use
export function sanitizeName(name: string, maxLength: number = MAX_NAME_LENGTH): string {
  return name.replace(/[^\w\s\-_.]/g, '').slice(0, maxLength).trim() || 'unnamed';
}

// Re-export used constants for consumers
export { MAX_NAME_LENGTH, MAX_DESCRIPTION_LENGTH };
