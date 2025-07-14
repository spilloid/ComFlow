export class TranscribeHandler {
  setNext(handler) { this.next = handler; return handler }
  async handle(ctx) {
    ctx.text = await ctx.transcriber.transcribe(ctx.pcm)
    return this.next?.handle(ctx)
  }
}
