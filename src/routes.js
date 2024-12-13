
import { BotController } from './Controllers/BotController'
import { FunctionController } from "./Controllers/FunctionController.js";

export const registerRoutes = (fastify) => {
    fastify.get('/', async (request, reply) => {
        reply.send({message: 'Twilio Media Stream Server is running!'})
    })

    fastify.get('/function', async (request, reply) => {
        const functionController = new FunctionController('./src/function.yaml')
        return functionController.tools
    })


    fastify.all('/incoming-call', async (request, reply) => {
        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`

        reply.type('text/xml').send(twimlResponse)
    })

    fastify.register(async (fastify) => {
        fastify.get('/media-stream', {websocket: true}, (connection, req) => {
            new BotController(connection)
        })
    })
}