import { ServiceFacade } from "../facade/ServiceFacade.js";
import { WhisperTranscriber } from "../lib/transcribers/WhisperTranscriber.js";
import { OllamaLLM } from "../lib/llm/OllamaLLM.js";
import { KokoroTTS } from "../lib/tts/KokoroTTS.js";

jest.mock("../lib/transcribers/WhisperTranscriber.js");
jest.mock("../lib/llm/OllamaLLM.js");
jest.mock("../lib/tts/KokoroTTS.js");

test("Facade invokes chain and emits processed on success", async () => {
    // Arrange: stub each service
    WhisperTranscriber.mockImplementation(() => ({
        transcribe: jest.fn().mockResolvedValue("hello"),
    }));
    OllamaLLM.mockImplementation(() => ({
        generate: jest.fn().mockResolvedValue("world"),
    }));
    KokoroTTS.mockImplementation(() => ({
        speak: jest.fn().mockResolvedValue(Buffer.from("audio")),
    }));

    const fakeSocket = { send: jest.fn() };
    const facade = new ServiceFacade({
        transcriber: new WhisperTranscriber(),
        llm: new OllamaLLM(),
        tts: new KokoroTTS(),
        socket: fakeSocket,
    });
    const processedSpy = jest.fn();
    facade.eventBus.subscribe("processed", processedSpy);

    // Act
    await facade.processAudio({
        pcm: Buffer.alloc(10),
        sendPort: 1234,
        sendHost: "1.2.3.4",
    });

    // Assert
    expect(processedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ text: "hello", response: "world" }),
    );
    expect(fakeSocket.send).toHaveBeenCalled();
});
