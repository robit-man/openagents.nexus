/**
 * IPFS/Helia storage layer
 *
 * Provides content-addressed storage using Helia (IPFS in JS).
 * Supports storing and retrieving files, JSON, strings, and DAG structures.
 */

import { createHelia } from 'helia';
import { json } from '@helia/json';
import { strings } from '@helia/strings';
import { dagJson } from '@helia/dag-json';
import { PinManager } from './pin.js';
import { MirrorManager } from './mirror.js';
import { ContentPropagation } from './propagation.js';
import { createLogger } from '../logger.js';

const log = createLogger('storage');

export class StorageManager {
  private helia: any = null;
  private jsonStore: any = null;
  private stringStore: any = null;
  private dagJsonStore: any = null;
  readonly pins: PinManager;
  readonly mirrors: MirrorManager;
  readonly propagation: ContentPropagation;

  constructor() {
    // PinManager and MirrorManager will be initialized when helia starts
    this.pins = null as any;
    this.mirrors = null as any;
    this.propagation = new ContentPropagation();
  }

  async start(libp2pNode: any): Promise<void> {
    // Create Helia node using the existing libp2p node
    this.helia = await createHelia({
      libp2p: libp2pNode,
    });

    this.jsonStore = json(this.helia);
    this.stringStore = strings(this.helia);
    this.dagJsonStore = dagJson(this.helia);

    (this as any).pins = new PinManager(this.helia);
    (this as any).mirrors = new MirrorManager(this.helia);

    // Wire the pin callback so ContentPropagation can auto-pin via PinManager
    this.propagation.setPinCallback((cid: string) => this.pins.pin(cid));

    log.info('Storage manager started');
  }

  async stop(): Promise<void> {
    if (this.helia) {
      await this.helia.stop();
      this.helia = null;
      log.info('Storage manager stopped');
    }
  }

  // Store a JSON object, returns CID string
  async storeJSON(data: unknown): Promise<string> {
    if (!this.jsonStore) throw new Error('Storage not started');
    const cid = await this.jsonStore.add(data);
    return cid.toString();
  }

  // Retrieve a JSON object by CID string
  async retrieveJSON(cidString: string): Promise<unknown> {
    if (!this.jsonStore) throw new Error('Storage not started');
    const { CID } = await import('multiformats/cid');
    const cid = CID.parse(cidString);
    return this.jsonStore.get(cid);
  }

  // Store a string, returns CID string
  async storeString(data: string): Promise<string> {
    if (!this.stringStore) throw new Error('Storage not started');
    const cid = await this.stringStore.add(data);
    return cid.toString();
  }

  // Retrieve a string by CID string
  async retrieveString(cidString: string): Promise<string> {
    if (!this.stringStore) throw new Error('Storage not started');
    const { CID } = await import('multiformats/cid');
    const cid = CID.parse(cidString);
    return this.stringStore.get(cid);
  }

  // Store a DAG-JSON object (supports CID links), returns CID string
  async storeDAG(data: unknown): Promise<string> {
    if (!this.dagJsonStore) throw new Error('Storage not started');
    const cid = await this.dagJsonStore.add(data);
    return cid.toString();
  }

  // Retrieve a DAG-JSON object by CID string
  async retrieveDAG(cidString: string): Promise<unknown> {
    if (!this.dagJsonStore) throw new Error('Storage not started');
    const { CID } = await import('multiformats/cid');
    const cid = CID.parse(cidString);
    return this.dagJsonStore.get(cid);
  }

  get isStarted(): boolean {
    return this.helia !== null;
  }
}

export { PinManager } from './pin.js';
export { MirrorManager } from './mirror.js';
export { ContentPropagation } from './propagation.js';
export {
  createBatch,
  signBatch,
  validateBatchStructure,
  MAX_BATCH_SIZE,
  type MessageBatch,
  type BatchMessage,
} from './message-batch.js';
export {
  createCheckpoint,
  signCheckpoint,
  validateCheckpointStructure,
  type RoomCheckpoint,
} from './checkpoint.js';
export {
  RetentionPolicyEngine,
  DEFAULT_RETENTION,
} from './retention.js';
export type {
  RetentionClass,
  RetentionConfig,
  StoredObject,
} from './retention.js';
