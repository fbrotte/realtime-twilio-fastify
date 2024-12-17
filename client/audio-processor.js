class PCMWorkletProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input[0]) {
            // Données audio capturées dans input[0] (canal gauche)
            const float32Samples = input[0];

            // Envoyer les données à l'application principale via `postMessage`
            this.port.postMessage(float32Samples);
        }
        return true; // Continue le traitement
    }
}

registerProcessor('pcm-worklet-processor', PCMWorkletProcessor);
