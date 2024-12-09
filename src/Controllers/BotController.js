import {OPENAI_API_KEY, SHOW_TIMING_MATH, SYSTEM_MESSAGE, VOICE, OPENAI_WSS} from "../config.js"
import WebSocket from "ws"

export class BotController {
    constructor(connection) {
        console.log('Initialisation')
        
        this.connection = connection
        this.markQueue = []
        this.lastAssistantItem = null
        this.latestMediaTimestamp = null
        this.responseStartTimestampTwilio = null
        this.lastAssistantItem = null
        this.streamSid = null

        this.openAiWs = new WebSocket(OPENAI_WSS, {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        })

        this.openAiWs.on('open', () => this.initializeSession())
        this.openAiWs.on('message', (data) => this.handleMessage(data))
        this.openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API')
        })
        this.openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error)
        })

        this.connection.on('message', (message) => this.handleMessageCall(message))

        this.connection.on('close', () => {
            if (this.openAiWs.readyState === WebSocket.OPEN)  this.openAiWs.close()
            console.log('Client disconnected.')
        })
    }

    initializeSession() {
        const sessionUpdate = {
            type: 'session.update',
            session: {
                turn_detection: {
                    type: "server_vad",
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 500
                },
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                input_audio_transcription: {
                    model: "whisper-1"
                },
                tools: [
                    {
                        type: "function",
                        name: "get_weather",
                        description: "Get the current weather for a location, tell the user you are fetching the weather.",
                        parameters: {
                            type: "object",
                            properties: {
                                location: {"type": "string"}
                            },
                            required: ["location"]
                        }
                    }
                ],
                tool_choice: "auto",
                voice: VOICE,
                instructions: SYSTEM_MESSAGE,
                modalities: ["text", "audio"],
                temperature: 0.8,
            }
        }
        console.log('Sending session update:', JSON.stringify(sessionUpdate))
        this.openAiWs.send(JSON.stringify(sessionUpdate))
    }
    sendInitialConversationItem() {
        const initialConversationItem = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: []
            }
        }

        if (SHOW_TIMING_MATH) console.log('Sending initial conversation item:', JSON.stringify(initialConversationItem))
        this.openAiWs.send(JSON.stringify(initialConversationItem))
        this.openAiWs.send(JSON.stringify({type: 'response.create'}))
    }

    handleSpeechStartedEvent() {
        if (this.markQueue.length < 0 || this.responseStartTimestampTwilio === null) return

        const elapsedTime = this.latestMediaTimestamp - this.responseStartTimestampTwilio
        if (SHOW_TIMING_MATH) console.log(`Calculating elapsed time for truncation: ${this.latestMediaTimestamp} - ${this.responseStartTimestampTwilio} = ${elapsedTime}ms`)

        if (this.lastAssistantItem) {
            const truncateEvent = {
                type: 'conversation.item.truncate',
                item_id: this.lastAssistantItem,
                content_index: 0,
                audio_end_ms: elapsedTime
            }
            if (SHOW_TIMING_MATH) console.log('Sending truncation event:', JSON.stringify(truncateEvent))
            this.openAiWs.send(JSON.stringify(truncateEvent))
        }

        this.connection.send(JSON.stringify({
            event: 'clear',
            streamSid: this.streamSid
        }))

        // Reset
        this.markQueue = []
        this.lastAssistantItem = null
        this.responseStartTimestampTwilio = null
    }
    sendMark() {
        if (this.streamSid) {
            const markEvent = {
                event: 'mark',
                streamSid: this.streamSid,
                mark: {name: 'responsePart'}
            }
            this.connection.send(JSON.stringify(markEvent))
            this.markQueue.push('responsePart')
        }
    }
    handleMessage(data){
        try {
            const response = JSON.parse(data)

            if (response.type === 'conversation.item.created') {
                console.log(`Assistant: ${response.item.role}`, JSON.stringify(response, null, 2))
            }

            if (response.type === 'conversation.item.input_audio_transcription.completed') {
                console.log(`User: ${response.transcript}`)
            }

            if (response.type === 'response.audio.delta' && response.delta) {
                const audioDelta = {
                    event: 'media',
                    streamSid: this.streamSid,
                    media: {payload: Buffer.from(response.delta, 'base64').toString('base64')}
                }
                this.connection.send(JSON.stringify(audioDelta))

                if (!this.responseStartTimestampTwilio) {
                    this.responseStartTimestampTwilio = this.latestMediaTimestamp
                    if (SHOW_TIMING_MATH) console.log(`Setting start timestamp for new response: ${this.responseStartTimestampTwilio}ms`)
                }

                if (response.item_id) {
                    this.lastAssistantItem = response.item_id
                }

                this.sendMark()
            }

            if (response.type === 'input_audio_buffer.speech_started') {
               this.handleSpeechStartedEvent()
            }
        } catch (error) {
            console.error('Error processing OpenAI message:', error, 'Raw message:', data)
        }
    }

    handleMessageCall(message){
        try {
            const data = JSON.parse(message)

            switch (data.event) {
                case 'media':
                    // console.log(`Media received: Timestamp: ${latestMediaTimestamp}, Payload size: ${data.media.payload.length}`)
                    this.latestMediaTimestamp = data.media.timestamp
                    if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${latestMediaTimestamp}ms`)
                    if (this.openAiWs.readyState === WebSocket.OPEN) {
                        const audioAppend = {
                            type: 'input_audio_buffer.append',
                            audio: data.media.payload
                        }
                        this.openAiWs.send(JSON.stringify(audioAppend))
                    }
                    break
                case 'start':
                    this.streamSid = data.start.streamSid
                    console.log('Incoming stream has started', this.streamSid)

                    this.responseStartTimestampTwilio = null
                    this.latestMediaTimestamp = 0
                    break
                case 'mark':
                    if (this.markQueue.length > 0) {
                        this.markQueue.shift()
                    }
                    break
                default:
                    console.log('Received non-media event:', data.event)
                    break
            }
        } catch (error) {
            console.error('Error parsing message:', error, 'Message:', message)
        }
    }
}
