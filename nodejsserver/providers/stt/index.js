'use strict';

const { DeepgramSttProvider } = require('./deepgram');

const REGISTRY = {
  deepgram: (config) => new DeepgramSttProvider(config),
};

let cached = null;

/**
 * Resolve the configured STT provider (memoized).
 * @param {string} [name]   override STT_PROVIDER
 * @param {object} [config]
 */
function getSttProvider(name, config) {
  if (cached && !name && !config) return cached;

  const key = (name || process.env.STT_PROVIDER || 'deepgram').toLowerCase();
  const factory = REGISTRY[key];
  if (!factory) {
    throw new Error(
      `Unknown STT provider "${key}". Available: ${Object.keys(REGISTRY).join(', ')}`,
    );
  }

  const provider = factory(config || {});
  if (!name && !config) cached = provider;
  return provider;
}

module.exports = { getSttProvider, STT_PROVIDERS: Object.keys(REGISTRY) };
