import {OPENAI_API_KEY, SHOW_TIMING_MATH, SYSTEM_MESSAGE, VOICE, OPENAI_WSS, OPENAI_EVENTS_LOG} from "../config.js"
import WebSocket from "ws"
import {FunctionController} from "./FunctionController.js";

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

        this.functionController = new FunctionController('./src/function.yaml');

        this.openAiWs = new WebSocket(OPENAI_WSS, {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        })

        // Open Ai Event
        this.openAiWs.on('open', () => this.initializeSession())
        this.openAiWs.on('message', (data) => this.handleOpenAi(data))
        this.openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API')
        })
        this.openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error)
        })

        // Twilio Event
        this.connection.on('message', (message) => this.handleTwilio(message))
        this.connection.on('close', () => {
            if (this.openAiWs.readyState === WebSocket.OPEN)  this.openAiWs.close()
            console.log('Client disconnected.')
        })
    }

    initializeSession() {

        console.log('initializeSession')

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
                tools: this.functionController.tools,
                tool_choice: "auto",
                voice: VOICE,
                instructions: SYSTEM_MESSAGE,
                modalities: ["text", "audio"],
                temperature: 0.8,
            }
        }
        this.sendDataToOpenAi(sessionUpdate)
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
        this.sendDataToOpenAi(initialConversationItem)
        this.sendDataToOpenAi({type: 'response.create'})
    }

    sendDataToTwilio(data){
        if(!this.streamSid) throw new Error("steamSid required")
        if(!data.event) throw new Error("Twilio data required event key")

        data.streamSid = this.streamSid
        this.connection.send(JSON.stringify(data))
    }

    sendDataToOpenAi(data){
        this.openAiWs.send(JSON.stringify(data))
    }

    sendMark() {
        if (this.streamSid) {
            const markEvent = {
                event: 'mark',
                mark: {name: 'responsePart'}
            }
            this.sendDataToTwilio(markEvent)
            this.markQueue.push('responsePart')
        }
    }
    async handleOpenAi(data){
        try {
            const response = JSON.parse(data)

            if(OPENAI_EVENTS_LOG.includes(response.type))
                console.error(response)

            if (response.type === 'response.content_part.done') {
                console.log(response.part.transcript)
            }

            if (response.type === 'conversation.item.input_audio_transcription.completed') {
                console.log(response.transcript)
            }

            if(response.type === 'response.function_call_arguments.done'){
                console.log(response.name, response.arguments)

                const result = await this.functionController.executeFunction(response.name, response.arguments)
                console.log("response ", result)
                const functionResponse = {
                    type: 'conversation.item.create',
                    item: {
                        type: "function_call_output",
                        call_id: 'response.call_id',
                        output: result
                    },
                };
                this.sendDataToOpenAi(functionResponse);

            }

            if (response.type === 'response.audio.delta' && response.delta) {
                const audioDelta = {
                    event: 'media',
                    media: {payload: Buffer.from(response.delta, 'base64').toString('base64')}
                }
                this.sendDataToTwilio(audioDelta)

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

    handleTwilio(message){
        try {
            const data = JSON.parse(message)

            switch (data.event) {
                case 'media':
                    // console.log(`Media received: Timestamp: ${latestMediaTimestamp}, Payload size: ${data.media.payload.length}`)
                    this.latestMediaTimestamp = data.media.timestamp
                    if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${this.latestMediaTimestamp}ms`)
                    if (this.openAiWs.readyState === WebSocket.OPEN) {
                        const audioAppend = {
                            type: 'input_audio_buffer.append',
                            audio: data.media.payload
                        }
                        this.sendDataToOpenAi(audioAppend)
                    }
                    break
                case 'start':
                    this.streamSid = data.start.streamSid
                    console.log('Call started', this.streamSid)

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

    handleSpeechStartedEvent() {
        console.log("handleSpeechStartedEvent")

        if (this.markQueue.length < 0 || this.responseStartTimestampTwilio === null) return

        const elapsedTime = this.latestMediaTimestamp - this.responseStartTimestampTwilio
        console.log(`Calculating elapsed time for truncation: ${this.latestMediaTimestamp} - ${this.responseStartTimestampTwilio} = ${elapsedTime}ms`)


        if (this.lastAssistantItem) {
            const truncateEvent = {
                type: 'conversation.item.truncate',
                item_id: this.lastAssistantItem,
                content_index: 0,
                audio_end_ms: elapsedTime
            }
            if (SHOW_TIMING_MATH) console.log('Sending truncation event:', JSON.stringify(truncateEvent))
            this.sendDataToOpenAi(truncateEvent)
        }

        this.sendDataToTwilio({
            event: 'clear',
        })

        // Reset
        this.markQueue = []
        this.lastAssistantItem = null
        this.responseStartTimestampTwilio = null
    }
}
