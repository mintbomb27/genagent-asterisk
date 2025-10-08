const WebSocket = require('ws');
const { v4: uuid } = require('uuid');
const { config, logger, logClient, logServer } = require('./config');
const { sipMap, cleanupPromises } = require('./state');
const { streamAudio, rtpEvents } = require('./rtp');

logger.info('Loading gemini.js module');

async function waitForBufferEmpty(channelId, maxWaitTime = 6000, checkInterval = 10) {
  const channelData = sipMap.get(channelId);
  if (!channelData?.streamHandler) {
    logServer(`No streamHandler for ${channelId}, proceeding`, 'info');
    return true;
  }
  const streamHandler = channelData.streamHandler;
  const startWaitTime = Date.now();

  let audioDurationMs = 1000; // Default minimum
  if (channelData.totalDeltaBytes) {
    audioDurationMs = Math.ceil((channelData.totalDeltaBytes / 8000) * 1000) + 500; // Audio duration + 500ms margin
  }
  const dynamicTimeout = Math.min(audioDurationMs, maxWaitTime);
  logServer(`Using dynamic timeout of ${dynamicTimeout}ms for ${channelId} (estimated audio duration: ${(channelData.totalDeltaBytes || 0) / 8000}s)`, 'info');

  let audioFinishedReceived = false;
  const audioFinishedPromise = new Promise((resolve) => {
    rtpEvents.once('audioFinished', (id) => {
      if (id === channelId) {
        logServer(`Audio finished sending for ${channelId} after ${Date.now() - startWaitTime}ms`, 'info');
        audioFinishedReceived = true;
        resolve();
      }
    });
  });

  const isBufferEmpty = () => (
    (!streamHandler.audioBuffer || streamHandler.audioBuffer.length === 0) &&
    (!streamHandler.packetQueue || streamHandler.packetQueue.length === 0)
  );
  if (!isBufferEmpty()) {
    let lastLogTime = 0;
    while (!isBufferEmpty() && (Date.now() - startWaitTime) < maxWaitTime) {
      const now = Date.now();
      if (now - lastLogTime >= 50) {
        logServer(`Waiting for RTP buffer to empty for ${channelId} | Buffer: ${streamHandler.audioBuffer?.length || 0} bytes, Queue: ${streamHandler.packetQueue?.length || 0} packets`, 'info');
        lastLogTime = now;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    if (!isBufferEmpty()) {
      logger.warn(`Timeout waiting for RTP buffer to empty for ${channelId} after ${maxWaitTime}ms`);
      return false;
    }
    logServer(`RTP buffer emptied for ${channelId} after ${Date.now() - startWaitTime}ms`, 'info');
  }

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      if (!audioFinishedReceived) {
        logger.warn(`Timeout waiting for audioFinished for ${channelId} after ${dynamicTimeout}ms`);
      }
      resolve();
    }, dynamicTimeout);
  });
  await Promise.race([audioFinishedPromise, timeoutPromise]);

  logServer(`waitForBufferEmpty completed for ${channelId} in ${Date.now() - startWaitTime}ms`, 'info');
  return true;
}

async function startGeminiWebSocket(channelId) {
  const GEMINI_API_KEY = config.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    logger.error('GEMINI_API_KEY is missing in config');
    throw new Error('Missing GEMINI_API_KEY');
  }

  let channelData = sipMap.get(channelId);
  if (!channelData) {
    throw new Error(`Channel ${channelId} not found in sipMap`);
  }

  let ws;
  let streamHandler = null;
  let retryCount = 0;
  const maxRetries = 3;
  let isResponseActive = false;
  let totalDeltaBytes = 0;
  let loggedDeltaBytes = 0;
  let segmentCount = 0;
  let responseBuffer = Buffer.alloc(0);
  let messageQueue = [];
  let itemRoles = new Map();
  let lastUserItemId = null;

  const processMessage = async (response) => {
    try {
        switch(Object.keys(response)[0]) {
            case 'setupComplete':
                logClient(`Setup Complete message received for ${channelId}`);
                break;
            case 'serverContent':
                if ("modelTurn" in response['serverContent'] && response['serverContent']['modelTurn']['parts'].length > 0) {
                    // Convert PCM 24000 Hz buffer to ULAW 8000 Hz before sending to streamHandler
                    const pcmBuffer = Buffer.from(response['serverContent']['modelTurn']['parts'][0]['inlineData']['data'], 'base64');
                    if (pcmBuffer.length > 0 && !pcmBuffer.every(byte => byte === 0x7F)) {
                        // Downsample from 24000 Hz to 8000 Hz (simple decimation: take every 3rd sample)
                        const pcm16 = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
                        const downsampled = Buffer.alloc(Math.floor(pcm16.length / 3) * 2);
                        for (let i = 0, j = 0; i < pcm16.length; i += 3, j++) {
                            downsampled.writeInt16LE(pcm16[i], j * 2);
                        }

                        // Convert PCM16 to ULAW
                        function linearToUlaw(sample) {
                            const MULAW_MAX = 0x1FFF;
                            const MULAW_BIAS = 33;
                            let sign = (sample >> 8) & 0x80;
                            if (sign) sample = -sample;
                            if (sample > MULAW_MAX) sample = MULAW_MAX;
                            sample = sample + MULAW_BIAS;
                            let exponent = 7;
                            for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
                                exponent--;
                            }
                            let mantissa = (sample >> ((exponent === 0) ? 4 : (exponent + 3))) & 0x0F;
                            let ulawByte = ~(sign | (exponent << 4) | mantissa);
                            return ulawByte & 0xFF;
                        }

                        const ulawBuffer = Buffer.alloc(downsampled.length / 2);
                        for (let i = 0; i < downsampled.length; i += 2) {
                            const sample = downsampled.readInt16LE(i);
                            ulawBuffer[i / 2] = linearToUlaw(sample);
                        }

                        totalDeltaBytes += ulawBuffer.length;
                        channelData.totalDeltaBytes = totalDeltaBytes; // Store in channelData
                        sipMap.set(channelId, channelData);
                        segmentCount++;
                        if (totalDeltaBytes - loggedDeltaBytes >= 40000 || segmentCount >= 100) {
                            logServer(`Received audio delta for ${channelId}: ${ulawBuffer.length} bytes, total: ${totalDeltaBytes} bytes, estimated duration: ${(totalDeltaBytes / 8000).toFixed(2)}s`, 'info');
                            loggedDeltaBytes = totalDeltaBytes;
                            segmentCount = 0;
                        }

                        let packetBuffer = ulawBuffer;
                        if (totalDeltaBytes === ulawBuffer.length) {
                            const silenceDurationMs = config.SILENCE_PADDING_MS || 100;
                            const silencePackets = Math.ceil(silenceDurationMs / 20);
                            const silenceBuffer = Buffer.alloc(silencePackets * 160, 0x7F);
                            packetBuffer = Buffer.concat([silenceBuffer, ulawBuffer]);
                            logger.info(`Prepended ${silencePackets} silence packets (${silenceDurationMs} ms) for ${channelId}`);
                        }

                        if (sipMap.has(channelId) && streamHandler) {
                            streamHandler.sendRtpPacket(packetBuffer);
                        }
                    } else {
                        logger.warn(`Received empty or silent delta for ${channelId}`);
                    }
                } else if ("generationComplete" in response['serverContent']) {
                    if (response['serverContent']['generationComplete']) {
                        segmentCount = 0;
                        isResponseActive = false;
                        logServer("Server Generation Complete.")
                        loggedDeltaBytes = 0;
                        itemRoles.clear();
                        lastUserItemId = null;
                        responseBuffer = Buffer.alloc(0);
                    }
                }
                break;
            default:
                break;
        }
    } catch (e) {
      logger.error(`Error processing message for ${channelId}: ${e.message}`);
      logger.error(JSON.stringify(response['serverContent']['modelTurn']));
    }
  };

  const connectWebSocket = () => {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(`${config.REALTIME_URL}?key=${GEMINI_API_KEY}`, {
        headers: {
            'Content-Type': 'application/json'
        }
      });

      ws.on('open', async () => {
        logClient(`Gemini WebSocket connected for ${channelId}`);
        ws.send(JSON.stringify({
            setup: {
                model: `models/${config.LIVE_MODEL}`,
                // tools: [{"google_search": {}}] 
                generationConfig: {
                    responseModalities: ["AUDIO"]
                },
                systemInstruction: {
                    parts: [{"text":process.env.SYSTEM_INSTRUCTION.replaceAll('"', "")}]
                }
            }}));
        logClient(`Session Setup Sent for ${channelId}`);

        try {
          const rtpSource = channelData.rtpSource || { address: '127.0.0.1', port: 12000 };
          streamHandler = await streamAudio(channelId, rtpSource);
          channelData.ws = ws;
          channelData.streamHandler = streamHandler;
          channelData.totalDeltaBytes = 0; // Initialize totalDeltaBytes
          sipMap.set(channelId, channelData);

          const itemId = uuid().replace(/-/g, '').substring(0, 32);
          logClient(`Requested response for ${channelId}`);
          isResponseActive = true;
        //   resolve(ws);
        } catch (e) {
          logger.error(`Error setting up WebSocket for ${channelId}: ${e.message}`);
          reject(e);
        }
      });

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());
          logger.debug(`Raw WebSocket message for ${channelId}: ${JSON.stringify(response, null, 2)}`);
          messageQueue.push(response);
        } catch (e) {
          logger.error(`Error parsing WebSocket message for ${channelId}: ${e.message}`);
        }
      });

      ws.on('error', (e) => {
        logger.error(`WebSocket error for ${channelId}: ${e.message}`);
        if (retryCount < maxRetries && sipMap.has(channelId)) {
          retryCount++;
          setTimeout(() => connectWebSocket().then(resolve).catch(reject), 1000);
        } else {
          reject(new Error(`Failed WebSocket after ${maxRetries} attempts`));
        }
      });

      const handleClose = () => {
        logger.info(`WebSocket closed for ${channelId}`);
        channelData.wsClosed = true;
        channelData.ws = null;
        sipMap.set(channelId, channelData);
        ws.off('close', handleClose);
        const cleanupResolve = cleanupPromises.get(`ws_${channelId}`);
        if (cleanupResolve) {
          cleanupResolve();
          cleanupPromises.delete(`ws_${channelId}`);
        }
      };
      ws.on('close', handleClose);
    });
  };

  setInterval(async () => {
    const maxMessages = 5;
    for (let i = 0; i < maxMessages && messageQueue.length > 0; i++) {
      await processMessage(messageQueue.shift());
    }
  }, 25);

  try {
    await connectWebSocket();
  } catch (e) {
    logger.error(`Failed to start WebSocket for ${channelId}: ${e.message}`);
    throw e;
  }
}

module.exports = { startGeminiWebSocket };
