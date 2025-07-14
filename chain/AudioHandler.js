export class AudioHandler {
  setNext(handler) { this.next = handler; return handler }
  async handle(ctx) {
    // do initial audio assembly (e.g. buffer RTP → PCM)
    return this.next?.handle(ctx)
  }
}
