/**
 * Bootstrap manifest types and utilities.
 *
 * A BootstrapManifest is the canonical federated bootstrap artifact.
 * It is a signed, versioned document listing seed peers for a network,
 * and may be distributed from multiple mirrors with no single authoritative source.
 */

export interface BootstrapSeed {
  peerId: string;
  addrs: string[];
  roles: ('bootstrap' | 'dht-server' | 'relay' | 'storage')[];
  observedRegion?: string;
}

export interface BootstrapManifest {
  schema: 'nexus:bootstrap-manifest:v1';
  version: number;
  seq: number;
  issuedAt: number;
  expiresAt: number;
  networkId: string;
  seeds: BootstrapSeed[];
  signers: string[]; // public keys of signers
  signatures: Array<{
    publicKey: string;
    sig: string;
  }>;
}

/**
 * Validate the structure of a manifest object.
 * Returns true only when all required fields are present with the correct types.
 * Does NOT verify cryptographic signatures.
 */
export function validateManifestStructure(manifest: unknown): manifest is BootstrapManifest {
  if (!manifest || typeof manifest !== 'object') return false;
  const m = manifest as Record<string, unknown>;
  if (m['schema'] !== 'nexus:bootstrap-manifest:v1') return false;
  if (typeof m['seq'] !== 'number') return false;
  if (typeof m['issuedAt'] !== 'number') return false;
  if (typeof m['expiresAt'] !== 'number') return false;
  if (!Array.isArray(m['seeds'])) return false;
  if (!Array.isArray(m['signatures'])) return false;
  return true;
}

/**
 * Check if a manifest has passed its expiry time.
 */
export function isManifestExpired(manifest: BootstrapManifest): boolean {
  return Date.now() > manifest.expiresAt;
}

/**
 * Extract all multiaddrs from a manifest's seeds list.
 * Returns a flat array in seed order; each seed may contribute multiple addrs.
 */
export function extractPeersFromManifest(manifest: BootstrapManifest): string[] {
  return manifest.seeds.flatMap(seed => seed.addrs);
}
