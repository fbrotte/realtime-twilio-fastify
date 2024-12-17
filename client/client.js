// URL du WebSocket
const WS_URL = 'ws://localhost:5050/media-stream';
// Fonction principale
async function startAudioStream() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioContext = new AudioContext();

        // Charger l'AudioWorklet
        await audioContext.audioWorklet.addModule('audio-processor.js');

        // Créer une instance du processeur
        const workletNode = new AudioWorkletNode(audioContext, 'pcm-worklet-processor');

        // Connexion avec WebSocket
        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('WebSocket connecté');
        };

        ws.onclose = () => {
            console.log('WebSocket déconnecté');
        };

        ws.onerror = (error) => {
            console.error('Erreur WebSocket:', error);
        };

        // Écouter les messages provenant de l'AudioWorklet
        workletNode.port.onmessage = (event) => {
            if (ws.readyState === WebSocket.OPEN) {
                const float32Samples = event.data;
                const int16Samples = float32ToInt16(float32Samples);

                // Convertir en base64
                const base64Audio = arrayBufferToBase64(int16Samples.buffer);

                // Envoyer au serveur dans le format Twilio
                const message = createTwilioMessage(base64Audio, Date.now());
                ws.send(message);
            }
        };

        // Connecter le microphone au processeur
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(workletNode);
    } catch (error) {
        console.error('Erreur lors de la capture audio:', error);
    }
}

// Conversion Float32 -> Int16
function float32ToInt16(floatSamples) {
    const int16Samples = new Int16Array(floatSamples.length);
    for (let i = 0; i < floatSamples.length; i++) {
        let sample = floatSamples[i];
        sample = sample < -1 ? -1 : sample > 1 ? 1 : sample; // Clamp entre -1 et 1
        int16Samples[i] = sample * 32767; // Conversion en 16 bits
    }
    return int16Samples;
}

// Conversion ArrayBuffer -> Base64
function arrayBufferToBase64(buffer) {
    const binary = String.fromCharCode(...new Uint8Array(buffer));
    return btoa(binary);
}

// Créer un message JSON structuré comme Twilio
function createTwilioMessage(base64Audio, timestamp) {
    return JSON.stringify({
        event: "media",
        media: {
            payload: base64Audio,
            timestamp: timestamp,
        },
    });
}

// Démarrer la capture audio au clic
document.getElementById('start-stream').addEventListener('click', startAudioStream);