import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateIdentity, saveKey, loadKey } from '../keys.js';

describe('generateIdentity', () => {
  it('returns a privateKey and peerId string', async () => {
    const { privateKey, peerId } = await generateIdentity();
    expect(privateKey).toBeDefined();
    expect(typeof peerId).toBe('string');
    expect(peerId.length).toBeGreaterThan(0);
  });

  it('returns an Ed25519 private key', async () => {
    const { privateKey } = await generateIdentity();
    expect(privateKey.type).toBe('Ed25519');
  });

  it('peerId starts with 12D or similar libp2p peer id format', async () => {
    const { peerId } = await generateIdentity();
    // Ed25519 keys produce peer ids starting with "12D3KooW..."
    expect(peerId).toMatch(/^1[0-9a-zA-Z]+$/);
  });

  it('generates unique identities on successive calls', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    expect(a.peerId).not.toBe(b.peerId);
  });

  it('private key has a .raw property that is a Uint8Array', async () => {
    const { privateKey } = await generateIdentity();
    expect(privateKey.raw).toBeInstanceOf(Uint8Array);
    expect(privateKey.raw.length).toBeGreaterThan(0);
  });
});

describe('saveKey and loadKey', () => {
  let tmpDir: string;
  let keyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));
    keyPath = path.join(tmpDir, 'identity.key');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves the key as a file at the given path', async () => {
    const { privateKey } = await generateIdentity();
    await saveKey(privateKey, keyPath);
    expect(fs.existsSync(keyPath)).toBe(true);
  });

  it('saved key file is not empty', async () => {
    const { privateKey } = await generateIdentity();
    await saveKey(privateKey, keyPath);
    const stat = fs.statSync(keyPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('creates intermediate directories if they do not exist', async () => {
    const { privateKey } = await generateIdentity();
    const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'identity.key');
    await saveKey(privateKey, deepPath);
    expect(fs.existsSync(deepPath)).toBe(true);
  });

  it('loadKey returns null when the file does not exist', async () => {
    const result = await loadKey(path.join(tmpDir, 'nonexistent.key'));
    expect(result).toBeNull();
  });

  it('round-trips: loaded key has the same type as saved key', async () => {
    const { privateKey } = await generateIdentity();
    await saveKey(privateKey, keyPath);
    const loaded = await loadKey(keyPath);
    expect(loaded).not.toBeNull();
    expect(loaded!.type).toBe(privateKey.type);
  });

  it('round-trips: loaded key derives the same peerId', async () => {
    const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
    const { privateKey } = await generateIdentity();
    const originalPeerId = peerIdFromPrivateKey(privateKey).toString();

    await saveKey(privateKey, keyPath);
    const loaded = await loadKey(keyPath);
    const loadedPeerId = peerIdFromPrivateKey(loaded!).toString();

    expect(loadedPeerId).toBe(originalPeerId);
  });

  it('round-trips: loaded key raw bytes match saved key raw bytes', async () => {
    const { privateKey } = await generateIdentity();
    await saveKey(privateKey, keyPath);
    const loaded = await loadKey(keyPath);
    expect(Buffer.from(loaded!.raw).toString('hex')).toBe(
      Buffer.from(privateKey.raw).toString('hex'),
    );
  });
});
