import {OPENAI_API_KEY, SHOW_TIMING_MATH, SYSTEM_MESSAGE, VOICE, OPENAI_WSS, OPENAI_EVENTS_LOG} from "../config"
import WebSocket from "ws"
import {FunctionController} from "./FunctionController";



export class BotController {
    private connection: WebSocket;
    private openAiWs: WebSocket;
    private markQueue: string[] = [];
    private lastAssistantItem: string | null  = null;
    private latestMediaTimestamp: number = 0;
    private responseStartTimestampTwilio: number | null = null;
    private streamSid: string | null = null;
    private functionController: FunctionController;

    constructor(connection: WebSocket) {
        console.log('Initialisation')

        this.connection = connection

        this.functionController = new FunctionController('./src/function.json');

        this.openAiWs = new WebSocket(OPENAI_WSS, {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        })

        // Open Ai Event
        this.openAiWs.on('open', () => this.initializeSession())
        this.openAiWs.on('message', (data: string) => this.handleOpenAi(data))
        this.openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API')
        })
        this.openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error)
        })

        // Twilio Event
        this.connection.on('message', (message: string) => this.handleTwilio(message))
        this.connection.on('close', () => {
            if (this.openAiWs.readyState === WebSocket.OPEN)  this.openAiWs.close()
            console.log('Client disconnected.')
        })

    }

    initializeSession() {
        console.log('initializeSession')
        this.sendDataToOpenAi({
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
        })

        this.sendDataToOpenAi({
            type: 'response.create',
            response: {
                instructions: "Dit bonjour a l'utilisateur"
            }
        })
    }

    sendDataToTwilio(data: SendTwilioData){
        data.streamSid = this.streamSid
        this.connection.send(JSON.stringify(data))
    }

    sendDataToOpenAi(data: SendOpenAiData){
        this.openAiWs.send(JSON.stringify(data))
    }

    sendMark() {
        if (this.streamSid) {
            this.sendDataToTwilio({
                event: "mark",
                mark: { name: 'responsePart' }
            })
            this.markQueue.push('responsePart')
        }
    }
    async handleOpenAi(data: string){
        try {
            const response: ReceiveOpenAiData = JSON.parse(data)

            if(OPENAI_EVENTS_LOG.includes(response.type))
                console.error(response)

            if (response.type === 'response.content_part.done') {
                console.log(response.part.transcript)
            }

            if (response.type === 'conversation.item.input_audio_transcription.completed') {
                console.log(response.transcript)
            }

            if(response.type === 'response.function_call_arguments.done'){
                console.log("Function :", response.name, response.arguments)

                this.sendDataToOpenAi({
                    type: 'response.create',
                    // response: {
                    //     instructions: "Dit a l'utilisateur que tu prend en charge ca demande"
                    // }
                })

                const result = await this.functionController.executeFunction(response.name, response.arguments)

                this.sendDataToOpenAi({
                    type: 'conversation.item.create',
                    item: {
                        type: "function_call_output",
                        call_id: response.call_id,
                        output: JSON.stringify(result)
                    },
                });
            }

            if (response.type === 'response.audio.delta' && response.delta) {
                this.sendDataToTwilio({
                    event: 'media',
                    media: {payload: Buffer.from(response.delta, 'base64').toString('base64')}
                })

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

    handleTwilio(message: string){
        try {
            const data: ReceiveTwilioData =  JSON.parse(message)

            switch (data.event) {
                case 'media':
                    // console.log(`Media received: Timestamp: ${latestMediaTimestamp}, Payload size: ${data.media.payload.length}`)
                    this.latestMediaTimestamp = data.media.timestamp
                    if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${this.latestMediaTimestamp}ms`)
                    if (this.openAiWs.readyState === WebSocket.OPEN) {
                        this.sendDataToOpenAi({
                            type: 'input_audio_buffer.append',
                            audio: data.media.payload
                        })
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


        // if (this.lastAssistantItem) {
        //     this.sendDataToOpenAi({
        //         type: 'conversation.item.truncate',
        //         item_id: this.lastAssistantItem,
        //         content_index: 0,
        //         audio_end_ms: elapsedTime
        //     })
        // }

        this.sendDataToTwilio({
            event: 'clear',
        })

        // Reset
        this.markQueue = []
        this.lastAssistantItem = null
        this.responseStartTimestampTwilio = null
    }
}
