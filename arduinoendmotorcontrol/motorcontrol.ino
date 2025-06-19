#include <Arduino.h>
#include <SoftwareSerial.h>

void executeCommand(String cmd);
void moveForward(int speed);
void moveBackward(int speed);
void turnLeft(int speed);
void turnRight(int speed);
void stopMotors();

const int FRAME_LEN = 58;
uint8_t buf[FRAME_LEN];
int idx = 0;

// Define motor control pins
const int PWMA = 3;    // PWM speed control for Motor A
const int AIN1 = 4;    // Direction control for Motor A
const int AIN2 = 7;

const int PWMD = 5;    // PWM speed control for Motor D
const int DIN1 = A0;   // Direction control for Motor D
const int DIN2 = A1;

const int PWMB = 9;    // PWM speed control for Motor B
const int BIN1 = 8;    // Direction control for Motor B
const int BIN2 = 12;

const int PWMC = 6;    // PWM speed control for Motor C
const int CIN1 = A2;   // Direction control for Motor C
const int CIN2 = A3;



// Standby Pin
const int STBY = 2;    // Standby control pin

SoftwareSerial BTmst(10, 11);  // (RX, TX)

void setup() {
  // Initialize hardware Serial for debugging (USB)
  Serial.begin(115200);
  BTmst.begin(9600);

  // Motor control pin initialization
  pinMode(PWMA, OUTPUT);
  pinMode(AIN1, OUTPUT);
  pinMode(AIN2, OUTPUT);

  pinMode(PWMB, OUTPUT);
  pinMode(BIN1, OUTPUT);
  pinMode(BIN2, OUTPUT);

  pinMode(PWMC, OUTPUT);
  pinMode(CIN1, OUTPUT);
  pinMode(CIN2, OUTPUT);

  pinMode(PWMD, OUTPUT);
  pinMode(DIN1, OUTPUT);
  pinMode(DIN2, OUTPUT);

  pinMode(STBY, OUTPUT);
  digitalWrite(STBY, HIGH); // Enable the motor driver
  
  Serial.println("Arduino Motor Controller Started");
}

void loop() {

    if(BTmst.available()) {
    String command = BTmst.readStringUntil('\n');
    command.trim();
    Serial.print("Received command: ");
    Serial.println(command);
    executeCommand(command);
    }

  
  /*while (Serial.available() && idx < FRAME_LEN) {
    buf[idx++] = Serial.read();
  }
  if (idx < FRAME_LEN) return;
  idx = 0;

  // 2) Validate header
  if (buf[0]!=0xA5 || buf[1]!=0x5A || buf[2]!=0x3A) return;

  // 3) Get start/stop angles (×100)
  uint16_t start = (uint16_t(buf[5])<<8)|buf[6];
  uint16_t stop  = (uint16_t(buf[55])<<8)|buf[56];

  // 4) Extract 16 distances
  float dists[16];
  for (int i=0; i<16; i++){
    int b = 7 + i*3;
    uint16_t mm = (uint16_t(buf[b])<<8) | buf[b+1];
    dists[i] = mm / 1000.0f;  // → meters
  }

  // 5) Send ASCII line: R:start,stop,d0,…d15\n
  BTmst.print("R:");
  BTmst.print(start/100.0f,2); BTmst.print(',');
  BTmst.print(stop/100.0f,2);  BTmst.print(',');
  for (int i=0;i<16;i++){
    BTmst.print(dists[i],3);
    if (i<15) BTmst.print(',');
  }
  BTmst.print('\n');
  */
}


// Function to execute motor commands
void executeCommand(String cmd) {
  int colonindex=cmd.indexOf(':');
  if(colonindex!=-1){
    String action=cmd.substring(0,colonindex);
    String timestr=cmd.substring(colonindex+1);
    int duration=timestr.toInt();
  if (action.equalsIgnoreCase("move forward")) {
    moveForward(200);
    Serial.println("Arduino: Moving forward");
    delay(duration);
    stopMotors();
  }
  else if (action.equalsIgnoreCase("move backward")) {
    moveBackward(250);
    Serial.println("Arduino: Moving backward");
    delay(duration);
    stopMotors();
  }
  else if (action.equalsIgnoreCase("turn left")) {
    turnLeft(250);
    Serial.println("Arduino: Turning left");
    delay(duration);
    stopMotors();
  }
  else if (action.equalsIgnoreCase("turn right")) {
    turnRight(250);
    Serial.println("Arduino: Turning right");
    delay(duration);
    stopMotors();
  }
  else if (cmd.equalsIgnoreCase("stop")) {
    stopMotors();
    Serial.println("Arduino: Stopping motors");
  }
  else {
    Serial.println("Arduino: Unknown command");
  }
  }else{
    if (cmd.equalsIgnoreCase("move forward")) {
      moveForward(250);
      Serial.println("Arduino: Moving forward indefinitely");
    }
    else if (cmd.equalsIgnoreCase("move backward")) {
      moveBackward(250);
      Serial.println("Arduino: Moving backward indefinitely");
    }
    else if (cmd.equalsIgnoreCase("turn left")) {
      turnLeft(250);
      Serial.println("Arduino: Turning left indefinitely");
    }
    else if (cmd.equalsIgnoreCase("turn right")) {
      turnRight(250);
      Serial.println("Arduino: Turning right indefinitely");
    }
    else if (cmd.equalsIgnoreCase("stop")) {
      stopMotors();
      Serial.println("Arduino: Stopping motors");
    }
    else {
      Serial.println("Arduino: Unknown command");
    }
  }
  }


// Motor control functions
void moveForward(int speed) {
  // Motor A
  digitalWrite(AIN1, LOW);
  digitalWrite(AIN2, HIGH);
  analogWrite(PWMA, speed);

  // Motor B
  digitalWrite(BIN1, HIGH);
  digitalWrite(BIN2, LOW);
  analogWrite(PWMB, speed);

  // Motor C
  digitalWrite(CIN1, HIGH);
  digitalWrite(CIN2, LOW);
  analogWrite(PWMC, speed);

  // Motor D
  digitalWrite(DIN1, LOW);
  digitalWrite(DIN2, HIGH);
  analogWrite(PWMD, speed);
}

void moveBackward(int speed) {
  digitalWrite(AIN1, HIGH);
  digitalWrite(AIN2, LOW);
  analogWrite(PWMA, speed);

  digitalWrite(BIN1, LOW);
  digitalWrite(BIN2, HIGH);
  analogWrite(PWMB, speed);

  digitalWrite(CIN1, LOW);
  digitalWrite(CIN2, HIGH);
  analogWrite(PWMC, speed);

  digitalWrite(DIN1, HIGH);
  digitalWrite(DIN2, LOW);
  analogWrite(PWMD, speed);
}

void turnLeft(int speed) {
  // Stop left motors, move right motors forward
  digitalWrite(AIN1, LOW);
  digitalWrite(AIN2, HIGH);
  analogWrite(PWMA, speed);

  digitalWrite(BIN1, HIGH);
  digitalWrite(BIN2, LOW);
  analogWrite(PWMB, speed);

  digitalWrite(CIN1, LOW);
  digitalWrite(CIN2, HIGH);
  analogWrite(PWMC, speed);

  digitalWrite(DIN1, LOW);
  digitalWrite(DIN2, LOW);
  analogWrite(PWMD, 0);
}

void turnRight(int speed) {
  // Stop right motors, move left motors forward
  digitalWrite(AIN1, LOW);
  digitalWrite(AIN2, LOW);
  analogWrite(PWMA, 0);

  digitalWrite(BIN1, LOW);
  digitalWrite(BIN2, HIGH);
  analogWrite(PWMB, speed);

  digitalWrite(CIN1, HIGH);
  digitalWrite(CIN2, LOW);
  analogWrite(PWMC, speed);

  digitalWrite(DIN1, LOW);
  digitalWrite(DIN2, HIGH);
  analogWrite(PWMD, speed);
}

void stopMotors() {
  digitalWrite(AIN1, LOW);
  digitalWrite(AIN2, LOW);
  analogWrite(PWMA, 0);

  digitalWrite(BIN1, LOW);
  digitalWrite(BIN2, LOW);
  analogWrite(PWMB, 0);

  digitalWrite(CIN1, LOW);
  digitalWrite(CIN2, LOW);
  analogWrite(PWMC, 0);

  digitalWrite(DIN1, LOW);
  digitalWrite(DIN2, LOW);
  analogWrite(PWMD, 0);
}



