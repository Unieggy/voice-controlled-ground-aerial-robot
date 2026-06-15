'use strict';

const { SixtyDbTtsProvider } = require('./sixtyDb');

/**
 * Registry of available TTS providers, keyed by the value of TTS_PROVIDER.
 * Add a new provider here and it becomes selectable with zero changes to the
 * rest of the app.
 */
const REGISTRY = {
  sixtydb: (config) => new SixtyDbTtsProvider(config),
};

let cached = null;

/**
 * Resolve the configured TTS provider (memoized).
 * @param {string} [name]   override TTS_PROVIDER
 * @param {object} [config] override env-based config
 * @returns {import('./TtsProvider').TtsProvider}
 */
function getTtsProvider(name, config) {
  if (cached && !name && !config) return cached;

  const key = (name || process.env.TTS_PROVIDER || 'sixtydb').toLowerCase();
  const factory = REGISTRY[key];
  if (!factory) {
    throw new Error(
      `Unknown TTS provider "${key}". Available: ${Object.keys(REGISTRY).join(', ')}`,
    );
  }

  const provider = factory(config || {});
  if (!name && !config) cached = provider;
  return provider;
}

module.exports = { getTtsProvider, TTS_PROVIDERS: Object.keys(REGISTRY) };
