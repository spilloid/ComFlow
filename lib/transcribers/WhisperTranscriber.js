// lib/WhisperTranscriber.js
export class WhisperTranscriber {
    constructor({ url }) {
        this.url = url;
    }

    async transcribe(audioBuffer) {
        // stub: upload to Whisper endpoint, return transcript string
        return "";
    }
}
