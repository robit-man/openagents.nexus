export interface TrustPolicy {
  allowPeer(peerId: string): boolean;
  allowRoom(roomId: string, peerId: string): boolean;
  allowCapability(peerId: string, capability: string): boolean;
  allowRelay(peerId: string): boolean;
}
