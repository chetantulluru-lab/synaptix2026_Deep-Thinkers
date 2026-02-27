/**
 * broadcaster.js
 * Manages the WebSocket server and handles broadcasting messages
 * to every currently connected client.
 */

const { WebSocketServer, OPEN } = require("ws");
const { generateAttack }        = require("./attackGenerator");

// How often (ms) a new attack event is generated and broadcast
const ATTACK_INTERVAL_MS = 3000;

/**
 * Attaches a WebSocket server to an existing HTTP server instance.
 * Starts the attack simulation loop once the WS server is ready.
 *
 * @param {http.Server} httpServer - The Express HTTP server to attach to.
 * @returns {WebSocketServer}
 */
const initWebSocket = (httpServer) => {
  const wss = new WebSocketServer({ server: httpServer });

  // --- Connection lifecycle ---

  wss.on("connection", (socket, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log(`[WS] Client connected     — ${clientIP}  (total: ${wss.clients.size})`);

    // Send an immediate welcome / sync event so the UI isn't blank on load
    sendToClient(socket, {
      type:    "CONNECTED",
      message: "Connected to Cyber Command Center",
      timestamp: new Date().toISOString(),
    });

    socket.on("close", () => {
      console.log(`[WS] Client disconnected  — ${clientIP}  (total: ${wss.clients.size})`);
    });

    socket.on("error", (err) => {
      console.error(`[WS] Socket error (${clientIP}):`, err.message);
    });
  });

  wss.on("error", (err) => {
    console.error("[WS] Server error:", err.message);
  });

  // --- Attack simulation loop ---

  const simulationTimer = setInterval(() => {
    const attack = generateAttack();
    const payload = { type: "ATTACK", data: attack };

    const sent = broadcast(wss, payload);
    if (sent > 0) {
      console.log(
        `[SIM] ${attack.attackType.padEnd(11)} | ${attack.threatLevel.padEnd(6)} | ` +
        `${attack.country.padEnd(16)} | ${attack.sourceIP}`
      );
    }
  }, ATTACK_INTERVAL_MS);

  // Gracefully stop the timer if the WS server closes
  wss.on("close", () => clearInterval(simulationTimer));

  console.log(`[WS] WebSocket server ready — attack interval: ${ATTACK_INTERVAL_MS}ms`);
  return wss;
};

// --- Internal helpers ---

/**
 * Sends a JSON payload to a single WebSocket client (if the socket is open).
 *
 * @param {WebSocket} socket
 * @param {Object}    payload
 */
const sendToClient = (socket, payload) => {
  if (socket.readyState === OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

/**
 * Broadcasts a JSON payload to ALL connected clients.
 * Returns the number of clients the message was sent to.
 *
 * @param {WebSocketServer} wss
 * @param {Object}          payload
 * @returns {number}
 */
const broadcast = (wss, payload) => {
  const message = JSON.stringify(payload);
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === OPEN) {
      client.send(message);
      count++;
    }
  });
  return count;
};

module.exports = { initWebSocket };