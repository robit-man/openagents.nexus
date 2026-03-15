import { describe, it, expect, afterEach } from 'vitest';
import { createNexusNode } from '../../node.js';
import { DEFAULT_CONFIG, resolveConfig } from '../../config.js';
import { generateIdentity } from '../../identity/keys.js';

// Keep track of nodes so we can stop them after each test
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let node: any;

afterEach(async () => {
  if (node) {
    try {
      await node.stop();
    } catch {
      // ignore stop errors in cleanup
    }
    node = undefined;
  }
});

describe('createNexusNode', () => {
  it('returns a libp2p node instance', async () => {
    const { privateKey } = await generateIdentity();
    node = await createNexusNode(DEFAULT_CONFIG, privateKey);
    expect(node).toBeDefined();
    expect(typeof node.peerId).toBe('object');
  });

  it('node peerId matches the identity used to create it', async () => {
    const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
    const { privateKey } = await generateIdentity();
    const expectedPeerId = peerIdFromPrivateKey(privateKey).toString();
    node = await createNexusNode(DEFAULT_CONFIG, privateKey);
    expect(node.peerId.toString()).toBe(expectedPeerId);
  });

  it('node exposes identify service', async () => {
    const { privateKey } = await generateIdentity();
    node = await createNexusNode(DEFAULT_CONFIG, privateKey);
    expect((node.services as Record<string, unknown>)['identify']).toBeDefined();
  });

  it('node exposes dht service', async () => {
    const { privateKey } = await generateIdentity();
    node = await createNexusNode(DEFAULT_CONFIG, privateKey);
    expect((node.services as Record<string, unknown>)['dht']).toBeDefined();
  });

  it('node exposes pubsub service', async () => {
    const { privateKey } = await generateIdentity();
    node = await createNexusNode(DEFAULT_CONFIG, privateKey);
    expect((node.services as Record<string, unknown>)['pubsub']).toBeDefined();
  });

  it('node is started after creation', async () => {
    const { privateKey } = await generateIdentity();
    node = await createNexusNode(DEFAULT_CONFIG, privateKey);
    expect(node.status).toBe('started');
  });

  it('can be stopped cleanly', async () => {
    const { privateKey } = await generateIdentity();
    node = await createNexusNode(DEFAULT_CONFIG, privateKey);
    await node.stop();
    expect(node.status).toBe('stopped');
    node = undefined; // already stopped, don't stop again in afterEach
  });

  it('uses config listen addresses', async () => {
    const config = resolveConfig({
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
    });
    const { privateKey } = await generateIdentity();
    node = await createNexusNode(config, privateKey);
    // After start, the node should have assigned actual addresses
    const addrs = node.getMultiaddrs();
    expect(addrs.length).toBeGreaterThan(0);
  });

  it('light role configures DHT in client mode (does not throw)', async () => {
    const config = resolveConfig({ role: 'light' });
    const { privateKey } = await generateIdentity();
    // Should not throw even with clientMode DHT
    node = await createNexusNode(config, privateKey);
    expect(node).toBeDefined();
  });

  it('creates node without bootstrap peers when list is empty', async () => {
    const config = resolveConfig({ bootstrapPeers: [] });
    const { privateKey } = await generateIdentity();
    node = await createNexusNode(config, privateKey);
    expect(node).toBeDefined();
  });
});
