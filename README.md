# Asterisk to Gemini Live

This fork of Asterisk to OpenAI adds support for Gemini Live API as well.
This Node.js Asterisk ARI application integrates Asterisk 22 with the Gemini Live API to provide a voice-based virtual assistant for SIP calls. It processes audio in real-time and displays user and assistant transcriptions in the console.

---

## Features
- Real-time audio processing with Asterisk and Gemini.
- Console transcriptions for user and assistant speech.
- Clean resource management (channels, bridges, WebSocket, RTP).
- Configurable via `config.conf` (e.g., API key, prompt).

---

## Requirements
| Category      | Details                                      |
|---------------|---------------------------------------------|
| OS            | Ubuntu 24.04 LTS                            |
| Software      | - Node.js v18.20.8+ (`node -v`)<br>- Asterisk 22 with ARI enabled (`http.conf`, `ari.conf`)<br>- Node dependencies: `ari-client`, `ws`, `uuid`, `winston`, `chalk`, `dotenv` |
| Network       | - Ports: 8088 (ARI), 12000+ (RTP)<br>- Access to `wss://api.openai.com/v1/realtime` |
| Credentials   | - Gemini API key (`GEMINI_API_KEY`)<br>- ARI credentials (`asterisk`/`asterisk`) |

---

## Update!

- Auto-install script, just run on your Ubuntun 24 instance: 
  ```bash
  curl -sL https://raw.githubusercontent.com/mintbomb27/genagent_asterisk/main/autoinstall_asterisk_to_openai.sh | sudo bash -s
  ```

## Installation
1. Install prerequisites:
   ```bash
   sudo apt update
   sudo apt install nodejs npm asterisk
   ```
2. Configure Asterisk:
   - Enable HTTP
     ```bash
     sudo nano /etc/asterisk/http.conf
     ```
     Add the following lines at the end of the file:
     ```ini
     enabled=yes
     bindaddr=0.0.0.0
     bindport=8088
     ```
   - Configure ARI
     ```bash
     sudo nano /etc/asterisk/ari.conf
     ```
     Add the following lines after replacing the secure password.
     ```ini
     [asterisk]
     type=user
     password=<SECUREPASSWORD>
     ```
   - Add dialplan
     ```bash
     sudo nano /etc/asterisk/extensions.conf
     ```
     Add the following lines at the end of the file:
     ```ini
     [default]
     exten => 9999,1,Answer()
     same => n,Stasis(genagent_asterisk)
     same => n,Hangup()
     ```
     The above dialplan means once you dial 9999 on any extension, it connects to our ARI Application.
   - Configure SIP Extensions
     ```bash
     sudo nano /etc/asterisk/pjsip.conf
     ```
     Add the following lines at the end of the file to configure SIP extension 300 that can call 9999:
     ```ini
     [transport-udp]
     type=transport
     protocol=udp
     bind=0.0.0.0
     external_media_address=3.89.115.249  ; Required if your Asterisk Machine is behind a NAT (Public Cloud, VPS...)
     external_signaling_address=3.89.115.249  ; Required if your Asterisk Machine is behind a NAT (Public Cloud, VPS...)
     local_net=172.31.0.0/16  ; Optional: Adjust to your Local Network/VPC CIDR if different

     [300]
     type=endpoint
     context=default
     disallow=all
     allow=ulaw
     auth=300
     aors=300
     direct_media=no
     media_use_received_transport=yes
     rtp_symmetric=yes
     force_rport=yes
     rewrite_contact=yes
     dtmf_mode=auto

     [300]
     type=auth
     auth_type=userpass
     password=pass300
     username=300

     [300]
     type=aor
     max_contacts=2
     ```
   - Restart Asterisk:
     ```bash
     sudo systemctl restart asterisk
     ```
3. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/mintbomb27/genagent-asterisk.git
   cd genagent-asterisk
   npm install
   ```
4. Rename the `configs.conf.sample` to `configs.conf` & edit it in the project root to add your `GEMINI_API_KEY` in the designated field:
   ```bash
    mv configs.conf.sample configs.conf
    vim configs.conf
   ```
5. Run the application:
   ```bash
   node index.js
   ```

---

## Usage
1. Make a SIP call to the configured extension (e.g., `9999`).
2. Interact with the assistant (e.g., say "Hi, What is your name?").
3. Check console for transcriptions:
   ```
   O-0005 | 2025-06-28T04:15:01.924Z [INFO] [Agent] Assistant transcription: Hello! I'm Sofia...
   O-0010 | 2025-06-28T04:15:08.045Z [INFO] [Agent] User command transcription: What is your name?
   ```
4. End the call or press `Ctrl+C` to stop.

---

## Troubleshooting
- Error: `GEMINI_API_KEY is missing`: Verify `GEMINI_API_KEY` in `config.conf`.
- Error: `ARI connection error`: Check Asterisk (`sudo systemctl status asterisk`, port 8088). Run: sudo asterisk -rx "ari show status"
- No transcriptions: Set `LOG_LEVEL=debug` in `config.conf`.
- Debug commands:
  - Asterisk logs: `tail -f /var/log/asterisk/messages`
  - Node.js debug: `node --inspect index.js`
- Wrong password on SIP registration: Ensure the SIP phone username is `300` and password is `pass300`. Verify the server IP matches your Asterisk instance.
- No audio: Ensure `external_media_address` and `external_signaling_address` in `pjsip.conf` match your EC2 public IP. Verify RTP ports (12000+) are open in EC2 security group and local firewall. Update `asterisk.js` `external_host` to use the server’s IP.

---

## Contributing
- Report issues with logs and steps to reproduce.
- Submit pull requests via GitHub.
- License: MIT (see `LICENSE`).
