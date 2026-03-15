import { createLogger } from '../logger.js';

const log = createLogger('storage:mirror');

export class MirrorManager {
  private mirroredRooms = new Set<string>();
  private helia: any;

  constructor(helia: any) {
    this.helia = helia;
  }

  async mirrorRoom(roomId: string): Promise<void> {
    this.mirroredRooms.add(roomId);
    log.info(`Started mirroring room: ${roomId}`);
  }

  async stopMirroring(roomId: string): Promise<void> {
    this.mirroredRooms.delete(roomId);
    log.info(`Stopped mirroring room: ${roomId}`);
  }

  getMirroredRooms(): string[] {
    return Array.from(this.mirroredRooms);
  }

  isMirroring(roomId: string): boolean {
    return this.mirroredRooms.has(roomId);
  }
}
