/**
 * Agent Wallet Management
 *
 * Generates, saves, and loads secp256k1 wallets for agent-to-agent
 * USDC micropayments on Base. Private keys are stored locally with
 * restrictive file permissions (0o600) — NEVER shared over the network.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('x402:wallet');

export interface AgentWallet {
  account: PrivateKeyAccount;
  address: `0x${string}`;
  privateKey: `0x${string}`;
}

/**
 * Generate a fresh agent wallet (random secp256k1 keypair).
 */
export function generateWallet(): AgentWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  log.info(`Generated agent wallet: ${account.address}`);
  return { account, address: account.address, privateKey };
}

/**
 * Load an agent wallet from a key file.
 * Returns null if the file does not exist or is malformed.
 */
export function loadWallet(keyPath: string): AgentWallet | null {
  if (!fs.existsSync(keyPath)) return null;

  const hex = fs.readFileSync(keyPath, 'utf-8').trim();
  if (!hex.startsWith('0x') || hex.length !== 66) {
    log.error('Invalid wallet key file format (expected 0x + 64 hex chars)');
    return null;
  }

  const privateKey = hex as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  log.info(`Loaded agent wallet: ${account.address}`);
  return { account, address: account.address, privateKey };
}

/**
 * Save an agent wallet private key to disk with 0o600 permissions.
 * Creates intermediate directories if needed.
 */
export function saveWallet(wallet: AgentWallet, keyPath: string): void {
  const dir = path.dirname(keyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(keyPath, wallet.privateKey, { mode: 0o600 });
  log.info(`Saved wallet to ${keyPath}`);
}

/**
 * Load an existing wallet or generate a new one and persist it.
 */
export function loadOrCreateWallet(keyPath: string): AgentWallet {
  const existing = loadWallet(keyPath);
  if (existing) return existing;

  const wallet = generateWallet();
  saveWallet(wallet, keyPath);
  return wallet;
}
