
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createClient } = require("@deepgram/sdk");
const networkInterfaces = os.networkInterfaces();
console.log("Network Interfaces:", networkInterfaces);

const app = express();
const httpServer = require('http').createServer(app);
const PORT_HTTP = 3000;

const io = require('socket.io')(3001, {
  allowEIO3: true,
  cors: {
    origin: "*"
  }
});
const PORT_SOCKET = 3001;
const deepgramApiKey = "c9abfa13c0abfb368b00350ce4c6d5df47a1fd8a";
const deepgram = createClient(deepgramApiKey);
const UPLOAD_DIR = './uploads';

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

const pendingRequests = new Map();

app.use(express.raw({
  type: 'audio/wav',
  limit: '10mb'
}));

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

// Speech-to-text function using Deepgram
async function speechToText(filePath) {
    const audioBuffer = fs.readFileSync(filePath);
    console.log(`File ${filePath} read successfully, size: ${audioBuffer.length} bytes`);
    console.log("Sending request to Deepgram API...");
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      { 
        smart_format: true, 
        model: 'nova-2', 
        language: 'en-US' 
      }
    );
    
    if (error) {
      console.error('Deepgram transcription error:', error);
      return '';
    }
    if (!error) console.dir(result, {depth: null});
    console.log('Deepgram Response received');
    let transcript = '';
  try {
    transcript = result.results.channels[0].alternatives[0].transcript;
  } catch (err) {
    console.error('Error extracting transcript:', err);
  }
  
  return transcript;
}

// Start the HTTP server for file uploads
httpServer.listen(PORT_HTTP, () => {
  console.log(`HTTP server running on port ${PORT_HTTP}`);
});

// Socket.IO server is already listening on PORT_SOCKET
console.log(`Socket.IO server running on port ${PORT_SOCKET}`);