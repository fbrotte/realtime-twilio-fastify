import WebSocket from "ws";
import {OPENAI_API_KEY, OPENAI_WSS} from "../config";

export abstract class RealtimeController {
    wss_url: string
    key: string
    constructor(wss_url: string, key: string) {
        this.wss_url = wss_url
        this.key = key
    }

    abstract initalizeConnection(): WebSocket
}