interface SendTwilioData {
    event: "mark" | "clear" | "media";
    mark?: { name: string; };
    media?: { payload: string; };
    streamSid?: any;
}

interface ReceiveTwilioData {
    event: 'media' | 'start' | 'mark' | 'dtmf';
    media: {
        payload: Uint8Array;
        timestamp: number;
    };
    start: {
        streamSid: string;
    };
    dtmf: {
        digit: string;
    }
}
