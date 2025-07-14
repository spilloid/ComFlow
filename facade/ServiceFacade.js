import { AudioHandler }      from '../chain/AudioHandler.js'
import { TranscribeHandler } from '../chain/TranscribeHandler.js'
import { LlMHandler }        from '../chain/LlMHandler.js'
import { TTSHandler }        from '../chain/TTSHandler.js'
import { EventBus }          from '../observer/EventBus.js'

export class ServiceFacade {
  constructor({ transcriber, llm, tts, socket }) {
    this.bus    = new EventBus()
    this.socket = socket
    // attach observers
    import('../observer/observers/RTPStreamObserver.js').then(m => m.RTPStreamObserver(this.bus, socket))
    import('../observer/observers/LoggingObserver.js').then(m => m.LoggingObserver(this.bus))
    // build chain
    const audio   = new AudioHandler()
    const trans   = new TranscribeHandler()
    const llmH    = new LlMHandler()
    const ttsH    = new TTSHandler()
    audio.setNext(trans).setNext(llmH).setNext(ttsH)
    this.chain = audio
  }

  async processAudio(pcm) {
    const ctx = { pcm, transcriber: this.bus.transcriber, llm: this.bus.llm, tts: this.bus.tts }
    try {
      await this.chain.handle(ctx)
      this.bus.publish('processed', ctx)
    } catch(err) {
      this.bus.publish('error', err)
    }
  }
}
