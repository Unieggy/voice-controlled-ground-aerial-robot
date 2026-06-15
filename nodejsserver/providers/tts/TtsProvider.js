'use strict';

/**
 * Base class describing the TTS provider contract.
 *
 * Every provider is interchangeable: the rest of the app only depends on these
 * methods, never on a concrete service. Add a new provider by extending this
 * class and registering it in ./index.js.
 *
 * Common option shape (providers ignore what they don't support):
 *   {
 *     voiceId, outputFormat, speed, stability, similarity, enhance,
 *     sampleRate, encoding
 *   }
 */
class TtsProvider {
  /**
   * Synthesize the full clip in one shot.
   * @param {string} text
   * @param {object} [opts]
   * @returns {Promise<{audio: Buffer, contentType: string, format: string, sampleRate: number|null}>}
   */
  async synthesize(text, opts = {}) {
    throw new Error(`${this.constructor.name}.synthesize() not implemented`);
  }

  /**
   * Stream the clip as it is generated, yielding raw audio Buffers.
   * Default implementation falls back to one-shot synthesis so every provider
   * has a working stream even if it has no native streaming endpoint.
   * @param {string} text
   * @param {object} [opts]
   * @returns {AsyncGenerator<Buffer>}
   */
  async *synthesizeStream(text, opts = {}) {
    const { audio } = await this.synthesize(text, opts);
    yield audio;
  }
}

/** Map an output_format string to an HTTP content type. */
function contentTypeFor(format) {
  switch ((format || '').toLowerCase()) {
    case 'wav':
      return 'audio/wav';
    case 'ogg':
    case 'ogg_opus':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    case 'pcm':
    case 'linear16':
      return 'audio/L16';
    case 'mulaw':
    case 'ulaw':
      return 'audio/basic';
    case 'mp3':
    default:
      return 'audio/mpeg';
  }
}

module.exports = { TtsProvider, contentTypeFor };
