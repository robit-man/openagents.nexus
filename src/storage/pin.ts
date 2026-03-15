import { createLogger } from '../logger.js';

const log = createLogger('storage:pin');

export class PinManager {
  private helia: any;
  private pinnedCids = new Set<string>();

  constructor(helia: any) {
    this.helia = helia;
  }

  async pin(cidString: string): Promise<void> {
    try {
      const { CID } = await import('multiformats/cid');
      const cid = CID.parse(cidString);

      for await (const _ of this.helia.pins.add(cid)) {
        // drain
      }
      this.pinnedCids.add(cidString);
      log.info(`Pinned: ${cidString}`);
    } catch (err) {
      log.error(`Failed to pin ${cidString}: ${err}`);
      throw err;
    }
  }

  async unpin(cidString: string): Promise<void> {
    try {
      const { CID } = await import('multiformats/cid');
      const cid = CID.parse(cidString);

      for await (const _ of this.helia.pins.rm(cid)) {
        // drain
      }
      this.pinnedCids.delete(cidString);
      log.info(`Unpinned: ${cidString}`);
    } catch (err) {
      log.error(`Failed to unpin ${cidString}: ${err}`);
    }
  }

  getPinnedCids(): string[] {
    return Array.from(this.pinnedCids);
  }
}
