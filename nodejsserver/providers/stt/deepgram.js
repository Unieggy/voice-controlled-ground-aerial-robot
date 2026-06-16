'use strict';

const { createClient } = require('@deepgram/sdk');

/**
 * Deepgram speech-to-text provider.
 *
 * Mirrors the TTS provider pattern so STT is equally pluggable. The single
 * method the app depends on is transcribe(buffer) -> string.
 */
class DeepgramSttProvider {
  constructor(config = {}) {
    const apiKey = config.apiKey || process.env.DEEPGRAM_API_KEY || '';
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not set — cannot start Deepgram STT');
    }
    this.client = createClient(apiKey);
    this.options = {
      smart_format: true,
      model: config.model || 'nova-2',
      language: config.language || 'en-US',
    };
  }

  get name() {
    return 'deepgram';
  }

  /**
   * Transcribe a WAV/audio buffer to text.
   * @param {Buffer} audioBuffer
   * @returns {Promise<string>}
   */
  async transcribe(audioBuffer) {
    const { result, error } = await this.client.listen.prerecorded.transcribeFile(
      audioBuffer,
      this.options,
    );

    if (error) {
      console.error('Deepgram transcription error:', error);
      return '';
    }

    try {
      return result.results.channels[0].alternatives[0].transcript;
    } catch (err) {
      console.error('Error extracting transcript:', err);
      return '';
    }
  }
}

module.exports = { DeepgramSttProvider };
