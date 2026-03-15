import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveIdentity } from '../index.js';

describe('resolveIdentity — ephemeral (no options)', () => {
  it('returns a privateKey and peerId when no options given', async () => {
    const { privateKey, peerId } = await resolveIdentity({});
    expect(privateKey).toBeDefined();
    expect(typeof peerId).toBe('string');
    expect(peerId.length).toBeGreaterThan(0);
  });

  it('generates a different identity on each call', async () => {
    const a = await resolveIdentity({});
    const b = await resolveIdentity({});
    expect(a.peerId).not.toBe(b.peerId);
  });
});

describe('resolveIdentity — explicit privateKey bytes', () => {
  it('uses the provided raw key bytes', async () => {
    // Generate a key first, then pass its raw bytes in
    const { generateIdentity } = await import('../keys.js');
    const { privateKey: original, peerId: originalPeerId } = await generateIdentity();
    const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
    const { privateKeyToProtobuf } = await import('@libp2p/crypto/keys');

    // We store as protobuf bytes for unambiguous round-trip
    const rawBytes = privateKeyToProtobuf(original);
    const info = await resolveIdentity({ privateKey: rawBytes });

    expect(info.peerId).toBe(originalPeerId);
  });

  it('derived peerId matches what peerIdFromPrivateKey would produce', async () => {
    const { generateIdentity } = await import('../keys.js');
    const { privateKey } = await generateIdentity();
    const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
    const { privateKeyToProtobuf } = await import('@libp2p/crypto/keys');

    const rawBytes = privateKeyToProtobuf(privateKey);
    const info = await resolveIdentity({ privateKey: rawBytes });

    const expected = peerIdFromPrivateKey(privateKey).toString();
    expect(info.peerId).toBe(expected);
  });
});

describe('resolveIdentity — keyStorePath persistence', () => {
  let tmpDir: string;
  let keyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-id-test-'));
    keyPath = path.join(tmpDir, 'identity.key');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates and persists a key when no file exists', async () => {
    const info = await resolveIdentity({ keyStorePath: keyPath });
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(typeof info.peerId).toBe('string');
  });

  it('loads the same identity on subsequent calls', async () => {
    const first = await resolveIdentity({ keyStorePath: keyPath });
    const second = await resolveIdentity({ keyStorePath: keyPath });
    expect(second.peerId).toBe(first.peerId);
  });

  it('explicit privateKey takes priority over keyStorePath', async () => {
    // Create a persisted identity
    const persisted = await resolveIdentity({ keyStorePath: keyPath });

    // Now pass a different explicit key
    const { generateIdentity } = await import('../keys.js');
    const { privateKey: other } = await generateIdentity();
    const { privateKeyToProtobuf } = await import('@libp2p/crypto/keys');
    const rawBytes = privateKeyToProtobuf(other);

    const info = await resolveIdentity({ privateKey: rawBytes, keyStorePath: keyPath });
    expect(info.peerId).not.toBe(persisted.peerId);
  });
});
