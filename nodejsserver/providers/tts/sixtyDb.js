'use strict';

const WebSocket = require('ws');
const { TtsProvider, contentTypeFor } = require('./TtsProvider');

/**
 * 60db text-to-speech provider.  Docs: https://docs.60db.ai
 *
 * Three transports, all behind the same TtsProvider interface:
 *   - synthesize()           -> POST /tts-synthesize      (one JSON response)
 *   - synthesizeStream()     -> POST /tts-stream          (NDJSON chunks)
 *   - synthesizeWebSocket()  -> wss /ws/tts               (incremental context)
 *
 * Config is read once from the environment and can be overridden per call via
 * the opts argument.
 */
class SixtyDbTtsProvider extends TtsProvider {
  constructor(config = {}) {
    super();
    this.apiKey = config.apiKey || process.env.SIXTYDB_API_KEY || '';
    this.baseUrl = (config.baseUrl || process.env.SIXTYDB_BASE_URL || 'https://api.60db.ai').replace(/\/$/, '');
    this.wsUrl = config.wsUrl || process.env.SIXTYDB_WS_URL || 'wss://api.60db.ai/ws/tts';

    this.defaults = {
      voiceId: config.voiceId || process.env.SIXTYDB_VOICE_ID || undefined,
      outputFormat: config.outputFormat || process.env.SIXTYDB_OUTPUT_FORMAT || 'mp3',
      speed: numOr(process.env.SIXTYDB_SPEED, 1),
      stability: numOr(process.env.SIXTYDB_STABILITY, 50),
      similarity: numOr(process.env.SIXTYDB_SIMILARITY, 75),
      enhance: boolOr(process.env.SIXTYDB_ENHANCE, true),
    };
  }

  get name() {
    return 'sixtydb';
  }

  /** Build the JSON body shared by /tts-synthesize and /tts-stream. */
  _body(text, opts) {
    const o = { ...this.defaults, ...opts };
    const body = {
      text,
      enhance: o.enhance,
      speed: o.speed,
      stability: o.stability,
      similarity: o.similarity,
      output_format: o.outputFormat,
    };
    if (o.voiceId) body.voice_id = o.voiceId;
    return body;
  }

  _headers() {
    if (!this.apiKey) {
      throw new Error('SIXTYDB_API_KEY is not set — cannot call the 60db API');
    }
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /** One-shot synthesis via POST /tts-synthesize. */
  async synthesize(text, opts = {}) {
    assertText(text);
    const format = opts.outputFormat || this.defaults.outputFormat;
    const res = await fetch(`${this.baseUrl}/tts-synthesize`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(this._body(text, opts)),
    });

    if (!res.ok) {
      throw new Error(`60db /tts-synthesize failed: ${res.status} ${await safeText(res)}`);
    }

    const data = await res.json();
    if (data.success === false || !data.audio_base64) {
      throw new Error(`60db synthesis error: ${data.message || 'no audio returned'}`);
    }

    return {
      audio: Buffer.from(data.audio_base64, 'base64'),
      contentType: contentTypeFor(data.output_format || format),
      format: data.output_format || format,
      sampleRate: data.sample_rate || null,
    };
  }

  /**
   * Streaming synthesis via POST /tts-stream.
   * The response is NDJSON: one JSON object per line, each either
   *   { type: "chunk",    result: { audioContent: <base64> } }
   *   { type: "complete" }
   *   { type: "error",    message }
   */
  async *synthesizeStream(text, opts = {}) {
    assertText(text);
    const res = await fetch(`${this.baseUrl}/tts-stream`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(this._body(text, opts)),
    });

    if (!res.ok || !res.body) {
      throw new Error(`60db /tts-stream failed: ${res.status} ${await safeText(res)}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    for await (const part of res.body) {
      buffer += decoder.decode(part, { stream: true });

      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;

        const msg = parseJson(line);
        if (!msg) continue;

        if (msg.type === 'error') {
          throw new Error(`60db stream error: ${msg.message || 'unknown error'}`);
        }
        if (msg.type === 'complete') {
          return;
        }
        const b64 = msg?.result?.audioContent || msg.audioContent || msg.audio;
        if (b64) yield Buffer.from(b64, 'base64');
      }
    }

    // Flush any trailing line without a newline terminator.
    const tail = buffer.trim();
    if (tail) {
      const msg = parseJson(tail);
      const b64 = msg?.result?.audioContent || msg?.audioContent || msg?.audio;
      if (b64) yield Buffer.from(b64, 'base64');
    }
  }

  /**
   * WebSocket synthesis via wss /ws/tts.  Opens a context, pushes the text,
   * flushes, collects every audio_chunk, then closes.  Returns the joined clip
   * so it can be served exactly like synthesize().
   *
   * @param {string} text
   * @param {object} [opts]  may also include { encoding, sampleRate }
   * @returns {Promise<{audio: Buffer, contentType: string, format: string, sampleRate: number|null}>}
   */
  synthesizeWebSocket(text, opts = {}) {
    assertText(text);
    if (!this.apiKey) {
      return Promise.reject(new Error('SIXTYDB_API_KEY is not set — cannot open 60db websocket'));
    }

    const o = { ...this.defaults, ...opts };
    const encoding = o.encoding || 'LINEAR16';
    const sampleRate = o.sampleRate || 16000;
    const contextId = `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const url = `${this.wsUrl}?apiKey=${encodeURIComponent(this.apiKey)}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const chunks = [];
      let settled = false;

      const finish = (err) => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (_) { /* already closing */ }
        if (err) return reject(err);
        resolve({
          audio: Buffer.concat(chunks),
          contentType: contentTypeFor(encoding),
          format: encoding,
          sampleRate,
        });
      };

      const timer = setTimeout(() => finish(new Error('60db websocket timed out')), 30000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'create_context',
          context_id: contextId,
          voice_id: o.voiceId,
          audio_config: { encoding, sample_rate: sampleRate },
          speed: o.speed,
          stability: o.stability,
          similarity: o.similarity,
        }));
      });

      ws.on('message', (raw) => {
        const msg = parseJson(raw.toString());
        if (!msg) return;

        switch (msg.type) {
          case 'connection_established':
            // Auth confirmed; context creation already sent on open.
            break;
          case 'context_created':
            ws.send(JSON.stringify({ type: 'send_text', context_id: contextId, text }));
            ws.send(JSON.stringify({ type: 'flush_context', context_id: contextId }));
            break;
          case 'audio_chunk': {
            const b64 = msg?.result?.audioContent || msg.audio || msg.data || msg.audioContent;
            if (b64) chunks.push(Buffer.from(b64, 'base64'));
            break;
          }
          case 'flush_completed':
            ws.send(JSON.stringify({ type: 'close_context', context_id: contextId }));
            break;
          case 'context_closed':
            clearTimeout(timer);
            finish();
            break;
          case 'error':
            clearTimeout(timer);
            finish(new Error(`60db websocket error: ${msg.message || 'unknown error'}`));
            break;
          default:
            break;
        }
      });

      ws.on('error', (err) => { clearTimeout(timer); finish(err); });
      ws.on('close', () => { clearTimeout(timer); finish(); });
    });
  }
}

function assertText(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('TTS text must be a non-empty string');
  }
  if (text.length > 5000) {
    throw new Error('60db REST endpoints accept at most 5000 characters per request');
  }
}

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolOr(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function parseJson(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch (_) {
    return '';
  }
}

module.exports = { SixtyDbTtsProvider };
