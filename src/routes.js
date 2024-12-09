
// import incomingCallController from '../controllers/incomingCallController';
import WebSocket from "ws";

import { OPENAI_API_KEY, VOICE, SYSTEM_MESSAGE, SHOW_TIMING_MATH } from './config';

export const registerRoutes = (fastify) => {
    fastify.get('/', async (request, reply) => {
        reply.send({message: 'Twilio Media Stream Server is running!'});
    });

// Route for Twilio to handle incoming calls
// <Say> punctuation to improve text-to-speech translation
    fastify.all('/incoming-call', async (request, reply) => {
        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`;

        reply.type('text/xml').send(twimlResponse);
    });

// WebSocket route for media-stream
    fastify.register(async (fastify) => {
        fastify.get('/media-stream', {websocket: true}, (connection, req) => {
            console.log('Client connected');

            // Connection-specific state
            let streamSid = null;
            let latestMediaTimestamp = 0;
            let lastAssistantItem = null;
            let markQueue = [];
            let responseStartTimestampTwilio = null;

            const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    "OpenAI-Beta": "realtime=v1"
                }
            });

            // Control initial session with OpenAI
            const initializeSession = () => {
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
                };

                console.log('Sending session update:', JSON.stringify(sessionUpdate));
                openAiWs.send(JSON.stringify(sessionUpdate));

                // Uncomment the following line to have AI speak first:
                // sendInitialConversationItem();
            };

            // Send initial conversation item if AI talks first
            const sendInitialConversationItem = () => {
                const initialConversationItem = {
                    type: 'conversation.item.create',
                    item: {
                        type: 'message',
                        role: 'user',
                        content: []
                    }
                };

                if (SHOW_TIMING_MATH) console.log('Sending initial conversation item:', JSON.stringify(initialConversationItem));
                openAiWs.send(JSON.stringify(initialConversationItem));
                openAiWs.send(JSON.stringify({type: 'response.create'}));
            };

            // Handle interruption when the caller's speech starts
            const handleSpeechStartedEvent = () => {
                if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
                    const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
                    if (SHOW_TIMING_MATH) console.log(`Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`);

                    if (lastAssistantItem) {
                        const truncateEvent = {
                            type: 'conversation.item.truncate',
                            item_id: lastAssistantItem,
                            content_index: 0,
                            audio_end_ms: elapsedTime
                        };
                        if (SHOW_TIMING_MATH) console.log('Sending truncation event:', JSON.stringify(truncateEvent));
                        openAiWs.send(JSON.stringify(truncateEvent));
                    }

                    connection.send(JSON.stringify({
                        event: 'clear',
                        streamSid: streamSid
                    }));

                    // Reset
                    markQueue = [];
                    lastAssistantItem = null;
                    responseStartTimestampTwilio = null;
                }
            };

            // Send mark messages to Media Streams so we know if and when AI response playback is finished
            const sendMark = (connection, streamSid) => {
                if (streamSid) {
                    const markEvent = {
                        event: 'mark',
                        streamSid: streamSid,
                        mark: {name: 'responsePart'}
                    };
                    connection.send(JSON.stringify(markEvent));
                    markQueue.push('responsePart');
                }
            };

            // Open event for OpenAI WebSocket
            openAiWs.on('open', () => {
                console.log('Connected to the OpenAI Realtime API');
                setTimeout(initializeSession, 100);
            });

            // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
            openAiWs.on('message', (data) => {
                try {
                    const response = JSON.parse(data);

                    // if (LOG_EVENT_TYPES.includes(response.type)) {
                    //     console.log(`Received event: ${response.type}`, response);
                    // }

                    // if (response.type === 'response.audio.delta' && response.delta) {
                    //     console.log(`Assistant (audio response): ${response.delta}`);
                    // }

                    if (response.type === 'conversation.item.created') {
                        console.log(`Assistant: ${response.item.role}`, JSON.stringify(response, null, 2));
                    }

                    if (response.type === 'conversation.item.input_audio_transcription.completed') {
                        console.log(`User: ${response.transcript}`);
                    }

                    // if (response.type === 'response.text' && response.text) {
                    //     console.log(`Assistant (text response): "${response.text}"`);
                    // }


                    if (response.type === 'response.audio.delta' && response.delta) {
                        const audioDelta = {
                            event: 'media',
                            streamSid: streamSid,
                            media: {payload: Buffer.from(response.delta, 'base64').toString('base64')}
                        };
                        connection.send(JSON.stringify(audioDelta));

                        // First delta from a new response starts the elapsed time counter
                        if (!responseStartTimestampTwilio) {
                            responseStartTimestampTwilio = latestMediaTimestamp;
                            if (SHOW_TIMING_MATH) console.log(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`);
                        }

                        if (response.item_id) {
                            lastAssistantItem = response.item_id;
                        }

                        sendMark(connection, streamSid);
                    }

                    if (response.type === 'input_audio_buffer.speech_started') {
                        handleSpeechStartedEvent();
                    }
                } catch (error) {
                    console.error('Error processing OpenAI message:', error, 'Raw message:', data);
                }
            });

            // Handle incoming messages from Twilio
            connection.on('message', (message) => {
                try {
                    const data = JSON.parse(message);

                    switch (data.event) {
                        case 'media':
                            // console.log(`Media received: Timestamp: ${latestMediaTimestamp}, Payload size: ${data.media.payload.length}`);
                            latestMediaTimestamp = data.media.timestamp;
                            if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${latestMediaTimestamp}ms`);
                            if (openAiWs.readyState === WebSocket.OPEN) {
                                const audioAppend = {
                                    type: 'input_audio_buffer.append',
                                    audio: data.media.payload
                                };
                                openAiWs.send(JSON.stringify(audioAppend));
                            }
                            break;
                        case 'start':
                            streamSid = data.start.streamSid;
                            console.log('Incoming stream has started', streamSid);

                            // Reset start and media timestamp on a new stream
                            responseStartTimestampTwilio = null;
                            latestMediaTimestamp = 0;
                            break;
                        case 'mark':
                            if (markQueue.length > 0) {
                                markQueue.shift();
                            }
                            break;
                        default:
                            console.log('Received non-media event:', data.event);
                            break;
                    }
                } catch (error) {
                    console.error('Error parsing message:', error, 'Message:', message);
                }
            });

            // Handle connection close
            connection.on('close', () => {
                if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
                console.log('Client disconnected.');
            });

            // Handle WebSocket close and errors
            openAiWs.on('close', () => {
                console.log('Disconnected from the OpenAI Realtime API');
            });

            openAiWs.on('error', (error) => {
                console.error('Error in the OpenAI WebSocket:', error);
            });
        });
    });
}