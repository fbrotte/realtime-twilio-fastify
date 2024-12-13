interface SendOpenAiData {
    type:
        'session.update' |
        'response.create' |
        'input_audio_buffer.append' |
        'conversation.item.truncate' |
        'conversation.item.create',
    audio?: Uint8Array,
    item_id?: string,
    content_index?: number,
    audio_end_ms?: number,
    item?: {}
    session?: {}
    response?: {}
}

interface ReceiveOpenAiData {
    type:
        'response.content_part.done' |
        'conversation.item.input_audio_transcription.completed' |
        'response.function_call_arguments.done' |
        'response.audio.delta' |
        'input_audio_buffer.speech_started',
    [key: string]: any;
}