
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getSttProvider } = require('./providers/stt');
const { getTtsProvider } = require('./providers/tts');
const { contentTypeFor: contentTypeForFormat } = require('./providers/tts/TtsProvider');
const networkInterfaces = os.networkInterfaces();
console.log("Network Interfaces:", networkInterfaces);

const app = express();
const httpServer = require('http').createServer(app);
const PORT_HTTP = Number(process.env.PORT_HTTP) || 3000;

const PORT_SOCKET = Number(process.env.PORT_SOCKET) || 3001;
const io = require('socket.io')(PORT_SOCKET, {
  allowEIO3: true,
  cors: {
    origin: "*"
  }
});

// Speech-to-text provider (Deepgram by default; key now read from .env).
const stt = getSttProvider();
const UPLOAD_DIR = './uploads';

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

const pendingRequests = new Map();

app.use(express.raw({
  type: 'audio/wav',
  limit: '10mb'
}));
app.use(express.json());

app.post('/uploadAudio', async (req, res) => {
  try {
    const requestId = Date.now().toString();
    const fileName = `recording_${requestId}.wav`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    
    fs.writeFileSync(filePath, req.body);
    console.log(`Audio file saved: ${fileName}`);

    const transcription = await speechToText(filePath);
    console.log('Transcription:', transcription);
    if (!transcription) {
      res.status(400).send("Speech recognition failed");
      return;
    }

    const responsePromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error("Timeout waiting for Java client response"));
      }, 30000);
      
      pendingRequests.set(requestId, {
        resolve,
        timeoutId
      });
    });
    io.emit('processText', transcription);

    try {
      // Wait for the Java client to respond
      const javaResponse = await responsePromise;
      
      // Send the processed text back to ESP32
      res.status(200).send(javaResponse);
    } catch (error) {
      console.error('Error waiting for Java response:', error.message);
      res.status(504).send('Timeout waiting for processing');
    }
  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).send('Audio processing failed');
  }
});

app.get('/download/:filename', (req, res) => {
  const fileName = req.params.filename;
  const filePath = path.join(UPLOAD_DIR, fileName);
  res.download(filePath, fileName, (err) => {
    if (err) {
      console.error('Download error:', err);
      res.status(500).send("File could not be downloaded.");
    }
  });
});

// Text-to-speech via the configured TTS provider (60db by default).
// POST /tts  { text, transport?, voiceId?, outputFormat?, speed?, stability?, similarity?, enhance? }
//   transport: "http" (default) | "stream" | "websocket"
// Responds with raw audio bytes (Content-Type set from the chosen format).
app.post('/tts', async (req, res) => {
  try {
    const { text, transport = 'http', ...opts } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Body must include a non-empty "text" string' });
      return;
    }

    const tts = getTtsProvider();
    console.log(`TTS request (${tts.name}/${transport}): "${text.slice(0, 60)}"`);

    if (transport === 'stream') {
      // Stream audio to the client as 60db produces it.
      let headerSent = false;
      try {
        for await (const chunk of tts.synthesizeStream(text, opts)) {
          if (!headerSent) {
            res.setHeader('Content-Type', contentTypeForFormat(opts.outputFormat));
            res.setHeader('Transfer-Encoding', 'chunked');
            headerSent = true;
          }
          res.write(chunk);
        }
        if (!headerSent) {
          res.status(502).json({ error: 'TTS stream produced no audio' });
          return;
        }
        res.end();
      } catch (err) {
        if (!headerSent) {
          res.status(502).json({ error: `TTS streaming failed: ${err.message}` });
        } else {
          res.end(); // headers already flushed; just terminate the stream
        }
      }
      return;
    }

    const result =
      transport === 'websocket'
        ? await tts.synthesizeWebSocket(text, opts)
        : await tts.synthesize(text, opts);

    res.setHeader('Content-Type', result.contentType);
    res.status(200).send(result.audio);
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: `TTS failed: ${error.message}` });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected via Socket.IO:', socket.id);

  socket.on('identify', (clientType) => {
    console.log(`Client identified as: ${clientType}`);
  });

  socket.on('chatgptResponse', (response) => {
    console.log('Received chatgptResponse:', response);

    // Get the first pending request (oldest one)
    const firstRequestId = pendingRequests.keys().next().value;
    
    if (firstRequestId) {
      const { resolve, timeoutId } = pendingRequests.get(firstRequestId);
      
      // Clear the timeout and resolve the promise with the response
      clearTimeout(timeoutId);
      resolve(response);
      pendingRequests.delete(firstRequestId);
      
      console.log(`Resolved request ${firstRequestId} with response: ${response}`);
    } else {
      console.log('Received chatgptResponse but no pending requests');
    }
    
    // Also broadcast to any other clients that might be listening
    io.emit('chatgptResponse', response);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Speech-to-text via the configured STT provider (see providers/stt).
async function speechToText(filePath) {
    const audioBuffer = fs.readFileSync(filePath);
    console.log(`File ${filePath} read successfully, size: ${audioBuffer.length} bytes`);
    console.log(`Sending request to STT provider (${stt.name})...`);
    const transcript = await stt.transcribe(audioBuffer);
    console.log('STT response received');
    return transcript;
}

// Start the HTTP server for file uploads
httpServer.listen(PORT_HTTP, () => {
  console.log(`HTTP server running on port ${PORT_HTTP}`);
});

// Socket.IO server is already listening on PORT_SOCKET
console.log(`Socket.IO server running on port ${PORT_SOCKET}`);