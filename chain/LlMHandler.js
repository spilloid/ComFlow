export class LlMHandler {
  setNext(handler) { this.next = handler; return handler }
  async handle(ctx) {
    ctx.response = await ctx.llm.generate(ctx.text)
    return this.next?.handle(ctx)
  }
}
