/**
 * Key generation and storage
 *
 * Handles Ed25519 keypair generation, secure storage, import/export,
 * and key rotation for agent identities.
 */

import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PrivateKey } from '@libp2p/interface';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('identity:keys');

export interface GeneratedIdentity {
  privateKey: PrivateKey;
  peerId: string;
}

/**
 * Generate a new Ed25519 keypair and derive a PeerId from it.
 */
export async function generateIdentity(): Promise<GeneratedIdentity> {
  const privateKey = await generateKeyPair('Ed25519');
  const peerId = peerIdFromPrivateKey(privateKey).toString();
  log.info(`Generated new identity: ${peerId}`);
  return { privateKey, peerId };
}

/**
 * Persist a private key to the filesystem using protobuf encoding.
 * The file is written with mode 0o600 (owner read/write only).
 * Intermediate directories are created automatically.
 */
export async function saveKey(privateKey: PrivateKey, filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const encoded = privateKeyToProtobuf(privateKey);
  fs.writeFileSync(filePath, Buffer.from(encoded), { mode: 0o600 });
  log.info(`Saved key to ${filePath}`);
}

/**
 * Load a private key from the filesystem.
 * Returns null if the file does not exist.
 */
export async function loadKey(filePath: string): Promise<PrivateKey | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const buf = fs.readFileSync(filePath);
  const privateKey = privateKeyFromProtobuf(new Uint8Array(buf));
  log.info(`Loaded key from ${filePath}`);
  return privateKey;
}
