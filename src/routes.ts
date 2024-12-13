import { BotController } from './Controllers/BotController'
import { FunctionController } from "./Controllers/FunctionController";
import { FastifyInstance } from "fastify";
import { WebSocket } from 'ws';

export const registerRoutes = (fastify: FastifyInstance) => {
    fastify.get('/', async (request, reply) => {
        reply.send({message: 'Twilio Media Stream Server is running!'})
    })

    fastify.get('/function', async (request, reply) => {
        const functionController = new FunctionController('./src/function.json')
        functionController.executeFunction('rdvsindex', `{"RDV_DEBUT": "2024-11-18", "RDV_FIN": "2024-11-24"}`)
        // reply.send(functionController)
    })


    fastify.post('/incoming-call', async (request, reply) => {
        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`

        reply.type('text/xml').send(twimlResponse)
    })

    fastify.register(async (fastify: any) => {
        fastify.get('/media-stream', { websocket: true }, (connection: WebSocket) => {
            new BotController(connection)
        })
    })
}