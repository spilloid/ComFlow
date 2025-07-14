export class TTSHandler {
  setNext(handler) { this.next = handler; return handler }
  async handle(ctx) {
    await ctx.tts.speak(ctx.response)
    return this.next?.handle(ctx)
  }
}
