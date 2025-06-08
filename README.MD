# Voice-Controlled Vehicle 🚙🚁  
*(ESP32-S3 • Node.js • Deepgram • ChatGPT • Arduino UNO + TB6612)*

This repo contains **four coordinated codebases** that turn your spoken
command (“forward”, “hover”, “stop”… ) into real wheels or propellers in
~1 s.

| Folder               | Language / Toolchain | Role |
|----------------------|----------------------|------|
| **`node-server/`**   | Node 18 + Express    | Accepts raw WAV, transcribes with **Deepgram**, rebroadcasts text via Socket.IO |
| **`java-client/`**   | Java 17 + Maven      | Sends text to **OpenAI GPT-4o**, chooses an action, emits control bytes over the same Socket.IO room |
| **`esp32-speech/`**  | Arduino-ESP32 core   | Captures mic via I²S, stores to SPIFFS, HTTP-POSTs `/uploadAudio` |
| **`arduino-motor/`** | Arduino UNO (AVR)    | Reads UART, drives TB6612 motors & four SG90 servo-rack arms |

Everything lives side-by-side, so you can **clone once** and build only the
piece you care about.

---

## 0 . Prerequisites

| Layer | Requirements | Notes |
|-------|--------------|-------|
| Node  | **Node ≥ 18**, npm ≥ 9 | `npm install` takes < 5 s |
| Java  | **JDK 17+**, Maven 3.8+ | VS Code “Extension Pack for Java” helps |
| ESP32 | Arduino IDE 2.x *or* Arduino CLI / PlatformIO | Board: “ESP32-S3 Dev Module” |
| UNO   | Arduino IDE 2.x | Board: “Arduino UNO” |
| Hardware | INMP441 mic · TB6612 · 4× SG90 servos · Bluetooth HC-05 pair | See `docs/wiring.pdf` (optional) |

### Secrets

* Create `node-server/.env` from the template:

  ```bash
  cp node-server/.env.example node-server/.env
