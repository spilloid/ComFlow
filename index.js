// aiworker/index.js

import { createSocket } from "dgram";
import { ServiceFacade } from "./facade/ServiceFacade.js";

// 1. Load service implementations (Strategy pattern)
import { SoXConverter } from "./lib/converters/SoXConverter.js";
import { FFMpegReverseConverter } from "./lib/converters/FFMpegReverseConverter.js";
import { WhisperTranscriber } from "./lib/transcribers/WhisperTranscriber.js";
import { OllamaLLM } from "./lib/llm/OllamaLLM.js";
import { KokoroTTS } from "./lib/tts/KokoroTTS.js";

// 2. Configuration (env or defaults)
const RECEIVE_PORT = +process.env.RTP_PORT_IN || 4000;
const SEND_PORT = +process.env.RTP_PORT_OUT || 4001;
const ASTERISK_IP = process.env.ASTERISK_IP || "127.0.0.1";

// 3. Create RTP socket
const socket = createSocket("udp4");
socket.bind(RECEIVE_PORT, () => {
    console.log(`🔊 RTP input listening on port ${RECEIVE_PORT}`);
});

// 4. Instantiate facade with all dependencies
const facade = new ServiceFacade({
    transcriber: new WhisperTranscriber({ url: process.env.WHISPER_URL }),
    llm: new OllamaLLM({ url: process.env.OLLAMA_URL }),
    tts: new KokoroTTS({ url: process.env.KOKORO_URL }),
    socket, // for Observer to push audio back out
    converter: new SoXConverter(), // if your chain needs it
    reverse: new FFMpegReverseConverter(), // ditto
});

// 5. Wire incoming RTP → Facade
socket.on("message", async (msg, rinfo) => {
    // assume 12-byte RTP header, rest is raw PCM
    const pcm = msg.subarray(12);

    try {
        await facade.processAudio({
            pcm,
            rinfo,
            sendPort: SEND_PORT,
            sendHost: ASTERISK_IP,
        });
    } catch (err) {
        console.error("Error in call flow:", err);
    }
});
