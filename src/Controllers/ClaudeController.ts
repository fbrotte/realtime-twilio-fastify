import {RealtimeController} from "./RealtimeController";
import WebSocket from "ws";

export class ClaudeController extends RealtimeController {
    initalizeConnection() {
        return new WebSocket(this.wss_url, {
            headers: {
                Authorization: `Bearer ${this.key}`,
                "OpenAI-Beta": "realtime=v1"
            }
        })
    }
}