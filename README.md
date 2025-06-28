Asterisk to OpenAI Realtime Community Edition
This Node.js application integrates Asterisk 22 with the OpenAI Realtime API to provide a voice-based virtual assistant for SIP calls. It processes audio in real-time and displays user and assistant transcriptions in the console.
Features

Real-time audio processing with Asterisk and OpenAI.
Console transcriptions for user and assistant speech.
Clean resource management (channels, bridges, WebSocket, RTP).
Configurable via config.conf (e.g., API key, prompt).

Requirements

OS: Ubuntu 24.04 LTS
Software:
Node.js v18.20.8+ (node -v)
Asterisk 22 with ARI enabled (http.conf, ari.conf)
Node dependencies: ari-client, ws, uuid, winston, chalk, dotenv


Network:
Ports: 8088 (ARI), 12000+ (RTP)
Access to wss://api.openai.com/v1/realtime


Credentials:
OpenAI API key (OPENAI_API_KEY)
ARI credentials (asterisk/asterisk)



Installation

Install prerequisites:sudo apt update
sudo apt install nodejs npm asterisk


Configure Asterisk:
Enable HTTP in /etc/asterisk/http.conf:[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088


Configure ARI in /etc/asterisk/ari.conf:[general]
enabled=yes
[asterisk]
type=user
password=asterisk


Add dialplan in /etc/asterisk/extensions.conf:[default]
exten => 100,1,Answer()
same => n,Stasis(asterisk_to_openai_rt)
same => n,Hangup()


Restart Asterisk: sudo systemctl restart asterisk


Clone the repository and install dependencies:git clone https://github.com/infinitocloud/asterisk_to_openai_rt_community.git
cd asterisk_to_openai_rt_community
npm install


Edit config.conf in the project root and add your OPENAI_API_KEY in the designated field:OPENAI_API_KEY=


Run the application:node index.js



Usage

Make a SIP call to the configured extension (e.g., 100).
Interact with the assistant (e.g., say "Hi", "What is your name?").
Check console for transcriptions:O-0005 | 2025-06-28T04:15:01.924Z [INFO] [OpenAI] Assistant transcription: Hello! I'm Sofia...
O-0010 | 2025-06-28T04:15:08.045Z [INFO] [OpenAI] User command transcription: What is your name?


End the call or press Ctrl+C to stop.

Troubleshooting

Error: OPENAI_API_KEY is missing: Verify OPENAI_API_KEY in config.conf.
Error: ARI connection error: Check Asterisk (sudo systemctl status asterisk, port 8088).
No transcriptions: Set LOG_LEVEL=debug in config.conf.
Debug commands:
Asterisk logs: tail -f /var/log/asterisk/messages
Node.js debug: node --inspect index.js



Contributing

Report issues with logs and steps to reproduce.
Submit pull requests via GitHub.
License: MIT (see LICENSE).
