#include <Arduino.h>
#include <WiFi.h>
#include <driver/i2s.h>    
#include <SPIFFS.h>
#include <HTTPClient.h>
#include <HardwareSerial.h>
#include <Bluepad32.h>
#include <ESP32Servo.h>


Servo arm1;
Servo arm2;
Servo arm3;
Servo arm4;

int arm1pin = 11;
int arm2pin=19;
int arm3pin=20;
int arm4pin=9;

char* ssid = "ChinaNet-kapok-4303";
char* password = "07525583999";
const char* serverHost = "http://192.168.2.57:3000"; 
const char* uploadEndpoint = "/uploadAudio";

HardwareSerial BTslv(2); 
bool armsExtended = false;   // false = retracted, true = extended


#define I2S_WS 6
#define I2S_SD 4
#define I2S_SCK 5
#define I2S_PORT I2S_NUM_0

#define SAMPLE_RATE       16000       // in Hz
#define I2S_SAMPLE_BITS   16
#define I2S_BUFFER_SIZE   1024        // in 16-bit samples
#define I2S_NUM_BUFFERS   4
#define I2S_READ_LEN      (I2S_BUFFER_SIZE * I2S_NUM_BUFFERS)
#define RECORD_TIME       7           // seconds

const int AUDIO_DATA_SIZE = (I2S_SAMPLE_BITS / 8) * SAMPLE_RATE * RECORD_TIME;
const int FLASH_RECORD_SIZE = AUDIO_DATA_SIZE + 44; // Including WAV header
const char filename[] = "/audio_recording.wav";
const int headerSize = 44;

volatile bool recordingComplete = false;
volatile bool uploadComplete = false;

enum Mode { IDLE, SPEECH, MANUAL, FLYING};
Mode currentMode = IDLE;

#define BP32_MAX_GAMEPADS 4
ControllerPtr myControllers[BP32_MAX_GAMEPADS];

void i2sInit();
void recordAudio();
void writeWavHeader(File &file, uint32_t dataSize);
void updateWavHeader(const char* filepath, uint32_t dataSize);
void uploadFile(const char* filepath);
void processControllers();
void processGamepad(ControllerPtr ctl);
void sendMotorCommand(const String &command);


void onConnectedController(ControllerPtr ctl) {
  bool foundEmptySlot = false;
  for (int i = 0; i < BP32_MAX_GAMEPADS; i++) {
    if (myControllers[i] == nullptr) {
      Serial.printf("CALLBACK: Controller connected, index=%d\n", i);
      ControllerProperties properties = ctl->getProperties();
      Serial.printf("Controller model: %s, VID=0x%04x, PID=0x%04x\n",
                    ctl->getModelName().c_str(),
                    properties.vendor_id,
                    properties.product_id);
      myControllers[i] = ctl;
      foundEmptySlot = true;
      break;
    }
  }
  if (!foundEmptySlot) {
    Serial.println("CALLBACK: Controller connected, but no empty slot available");
  }
}

void onDisconnectedController(ControllerPtr ctl) {
  bool foundController = false;
  for (int i = 0; i < BP32_MAX_GAMEPADS; i++) {
    if (myControllers[i] == ctl) {
      Serial.printf("CALLBACK: Controller disconnected from index=%d\n", i);
      myControllers[i] = nullptr;
      foundController = true;
      break;
    }
  }
  if (!foundController) {
    Serial.println("CALLBACK: Controller disconnected, but not found in myControllers");
  }
}

void i2sInit() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = i2s_bits_per_sample_t(I2S_SAMPLE_BITS),
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = i2s_comm_format_t(I2S_COMM_FORMAT_STAND_I2S),
    .intr_alloc_flags = 0,
    .dma_buf_count = 8,
    .dma_buf_len = I2S_BUFFER_SIZE,
    .use_apll = 1,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = -1,
    .data_in_num = I2S_SD
  };

  esp_err_t err = i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  if (err != ESP_OK) {
    Serial.printf("Failed to install I2S driver: %d\n", err);
    return;
  }
  
  err = i2s_set_pin(I2S_PORT, &pin_config);
  if (err != ESP_OK) {
    Serial.printf("Failed to set I2S pins: %d\n", err);
    return;
  }
  i2s_zero_dma_buffer(I2S_PORT);
}

void recordAudio() {
  // Allocate buffer for recording
  int16_t* i2sBuffer = (int16_t*) malloc(I2S_READ_LEN);
  if (!i2sBuffer) {
    Serial.println("Failed to allocate I2S buffer");
    return;
  }
  
  // Remove old file if exists
  if (SPIFFS.exists(filename)) {
    SPIFFS.remove(filename);
  }
      
  File audioFile = SPIFFS.open(filename, FILE_WRITE);
  if (!audioFile) {
    Serial.println("Failed to open file for writing");
    free(i2sBuffer);
    return;
  }
      
  writeWavHeader(audioFile, AUDIO_DATA_SIZE);
      
  Serial.println("Recording started...");
  size_t bytesRead = 0;
  unsigned long totalBytesWritten = 0;
  unsigned long startTime = millis();
      
  while (millis() - startTime < RECORD_TIME * 1000) {
    esp_err_t result = i2s_read(I2S_PORT, i2sBuffer, I2S_READ_LEN, &bytesRead, 100);
    if (result == ESP_OK && bytesRead > 0) {
      audioFile.write((uint8_t*)i2sBuffer, bytesRead);
      totalBytesWritten += bytesRead;
    }
  }
      
  audioFile.close();
  updateWavHeader(filename, totalBytesWritten);
      
  Serial.printf("Recording finished. %lu bytes recorded\n", totalBytesWritten);
  free(i2sBuffer);
  recordingComplete = true;
  
  // After recording, if WiFi is connected, upload the file
  if (WiFi.status() == WL_CONNECTED) {
    uploadFile(filename);
  }
}

void writeWavHeader(File &file, uint32_t dataSize) {
  unsigned char header[headerSize];
  // "RIFF" chunk descriptor
  header[0] = 'R'; header[1] = 'I'; header[2] = 'F'; header[3] = 'F';
  uint32_t fileSize = dataSize + headerSize - 8;
  header[4] = fileSize & 0xFF;
  header[5] = (fileSize >> 8) & 0xFF;
  header[6] = (fileSize >> 16) & 0xFF;
  header[7] = (fileSize >> 24) & 0xFF;
  // "WAVE" format
  header[8] = 'W'; header[9] = 'A'; header[10] = 'V'; header[11] = 'E';
  // "fmt " subchunk
  header[12] = 'f'; header[13] = 'm'; header[14] = 't'; header[15] = ' ';
  header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0;
  header[20] = 1; header[21] = 0; // PCM format
  header[22] = 1; header[23] = 0; // Mono
  header[24] = SAMPLE_RATE & 0xFF;
  header[25] = (SAMPLE_RATE >> 8) & 0xFF;
  header[26] = (SAMPLE_RATE >> 16) & 0xFF;
  header[27] = (SAMPLE_RATE >> 24) & 0xFF;
  uint32_t byteRate = SAMPLE_RATE * 1 * I2S_SAMPLE_BITS / 8;
  header[28] = byteRate & 0xFF;
  header[29] = (byteRate >> 8) & 0xFF;
  header[30] = (byteRate >> 16) & 0xFF;
  header[31] = (byteRate >> 24) & 0xFF;
  header[32] = (1 * I2S_SAMPLE_BITS / 8); header[33] = 0;
  header[34] = I2S_SAMPLE_BITS; header[35] = 0;
  // "data" subchunk
  header[36] = 'd'; header[37] = 'a'; header[38] = 't'; header[39] = 'a';
  header[40] = dataSize & 0xFF;
  header[41] = (dataSize >> 8) & 0xFF;
  header[42] = (dataSize >> 16) & 0xFF;
  header[43] = (dataSize >> 24) & 0xFF;
  
  file.write(header, headerSize);
}

void updateWavHeader(const char* filepath, uint32_t dataSize) {
  File file = SPIFFS.open(filepath, "r+");
  if (!file) {
    Serial.println("Failed to open file for header update");
    return;
  }
  uint32_t fileSize = dataSize + headerSize - 8;
  file.seek(4);
  file.write((uint8_t*)&fileSize, 4);
  file.seek(40);
  file.write((uint8_t*)&dataSize, 4);
  file.close();
}
void relayToArduino(const String &payload) {
  int start = 0;
  while (start < payload.length()) {
    int end = payload.indexOf(';', start);
    if (end == -1) end = payload.length();
    String token = payload.substring(start, end);
    token.trim();
    if (token.length()) {
      BTslv.println(token);   // one per line -> Arduino
      delay(30);              // small UART gap
    }
    start = end + 1;
  }
}
void uploadFile(const char* filepath) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, cannot upload");
    return;
  }
  
  File file = SPIFFS.open(filepath, "r");
  if (!file) {
    Serial.println("Failed to open audio file for upload");
    return;
  }
  
  uint32_t fileSize = file.size();
  Serial.printf("Uploading file, size: %lu bytes\n", (unsigned long)fileSize);
  HTTPClient client;
  String url = String(serverHost) + uploadEndpoint;
  client.begin(url);
  client.addHeader("Content-Type", "audio/wav");
  client.addHeader("Content-Length", String(fileSize));
  
  Serial.print("Uploading to: ");
  Serial.println(url);
  
  int httpCode = client.sendRequest("POST", &file, fileSize);
  file.close();
  
  if (httpCode == HTTP_CODE_OK) {
    String response = client.getString();
    Serial.println("Server response: " + response);
    uploadComplete = true;
    relayToArduino(response); 
    
  } else {
    Serial.printf("Upload failed, error code: %d\n", httpCode);
  }
  client.end();
}

void sendMotorCommand(const String &command) {
  Serial.print("Sending motor command: ");
  Serial.println(command);
  BTslv.println(command);
}


void processGamepad(ControllerPtr ctl) {

  if (ctl->buttons() & 0x0002) {
    // Trigger recording only if we are not already in speech mode
    if (currentMode != SPEECH) {
      Serial.println("Circle button pressed: Starting Speech-to-Text recording");
      currentMode = SPEECH;
      recordAudio();
      // After recording, revert back to IDLE mode (or remain in SPEECH if desired)
      currentMode = IDLE;
    }
  }
  
  // Check if the PS4 X button (0x0001) is pressed.
  // This will switch to manual mode.
  if (ctl->buttons() & 0x0001) {
    if (currentMode != MANUAL) {
      Serial.println("X button pressed: Activating Manual Mode");
      currentMode = MANUAL;
    }
  }

  if (ctl->buttons() & 0x0004) {
    if (currentMode != FLYING) {
      Serial.println("Y button pressed: Activating Flying Mode");
      currentMode = FLYING;
  // Start spinning at full speed in one direction.
  // For a continuous rotation servo, values above or below 90 generally indicate rotation.
      unsigned long startTime = millis();
      while (millis() - startTime < 3000) {        // spin for 3 s
      if (!armsExtended) {                       // extend
        arm1.write(180); arm3.write(180);        // CW
        arm2.write(0);   arm4.write(0);          // CCW
      } else {                                   // retract
        arm1.write(0);   arm3.write(0);          // CCW
        arm2.write(180); arm4.write(180);        // CW
      }
      delay(20);
    }
      arm1.write(90);
      arm2.write(90);
      arm3.write(90);
      arm4.write(90);
      currentMode=IDLE;
      armsExtended = !armsExtended;  
    }
  }
  
  // When in manual mode, use the left joystick to control motion.
  if (currentMode == MANUAL) {
    int axisX = ctl->axisX();  // Range roughly -511 to 512
    int axisY = ctl->axisY();  // Range roughly -511 to 512
    const int threshold = 100;  // Deadzone threshold
    String command = "";
    
    // Determine forward/backward based on vertical axis (Y)
    if (axisY < -threshold) {
      command = "move forward";
    } else if (axisY > threshold) {
      command = "move backward";
    }
    
    // Determine turning based on horizontal axis (X)
    if (axisX < -threshold) {
      // Append turning command if not already moving backward/forward
      command = (command == "" ? "turn left" : command + " & turn left");
    } else if (axisX > threshold) {
      command = (command == "" ? "turn right" : command + " & turn right");
    }
    
    // If joystick is in deadzone, stop the motors.
    if (command == "") {
      command = "stop";
    }
    
    sendMotorCommand(command);
  }
  

}

void processControllers() {
  for (auto ctl : myControllers) {
    if (ctl && ctl->isConnected()&& ctl->hasData()) {
      if (ctl->isGamepad()) {
        processGamepad(ctl);
      } else {
        Serial.println("Unsupported controller type");
      }
    }
  }
}



void setup() {
  Serial.begin(115200);
  BTslv.begin(9600,SERIAL_8N1,16,17);
  Serial.println("HC-05 UART ready (9600)");

  
  delay(1000);
  Serial.println("\nESP32 Voice Control System Starting...");

  // Initialize SPIFFS
  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS initialization failed!");
    while (1);
  }
  Serial.println("SPIFFS initialized successfully");
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi connection failed. Continuing without network...");
  }
  
  // Initialize I2S for audio recording
  i2sInit();
  Serial.println("I2S initialized");
  arm1.attach(arm1pin, 1000, 2000);
  arm2.attach(arm2pin, 1000, 2000);
  arm3.attach(arm3pin, 1000, 2000);
  arm4.attach(arm4pin, 1000, 2000);
  
  // Setup Bluepad32
  Serial.printf("Firmware: %s\n", BP32.firmwareVersion());
  const uint8_t* addr = BP32.localBdAddress();
  Serial.printf("BD Addr: %02X:%02X:%02X:%02X:%02X:%02X\n",
                addr[0], addr[1], addr[2], addr[3], addr[4], addr[5]);
  BP32.setup(&onConnectedController, &onDisconnectedController);
  BP32.forgetBluetoothKeys();

  
  currentMode = IDLE;
}

void loop() {
  BP32.update();
  processControllers();
  delay(10);
}


