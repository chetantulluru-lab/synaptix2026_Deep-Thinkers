/**
 * server.js
 * Entry point — wires together Express and the WebSocket server,
 * then starts listening on the configured port.
 */

const http    = require("http");
const express = require("express");

const routes        = require("./routes");
const { initWebSocket } = require("./broadcaster");

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------
const PORT = process.env.PORT || 4000;

// --------------------------------------------------------------------------
// Express application setup
// --------------------------------------------------------------------------
const app = express();

app.use(express.json());                  // parse JSON request bodies
app.use(express.static('public'));

// Allow any frontend origin during development (tighten in production)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  next();
});

// Mount REST routes under /api
app.use("/api", routes);

// 404 fallback for unmatched HTTP routes
app.use((_req, res) => {
  res.status(404).json({ error: "Not found. See GET /api/info for available endpoints." });
});

// --------------------------------------------------------------------------
// HTTP server — shared with WebSocket
// --------------------------------------------------------------------------
const httpServer = http.createServer(app);

// --------------------------------------------------------------------------
// WebSocket server — attached to the same port as Express
// --------------------------------------------------------------------------
initWebSocket(httpServer);

// --------------------------------------------------------------------------
// Start listening
// --------------------------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   3D Cybersecurity Command Center — Backend  ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`[HTTP] REST API  → http://localhost:${PORT}/api`);
  console.log(`[WS]  WebSocket → ws://localhost:${PORT}`);
  console.log("------------------------------------------------");
});

// --------------------------------------------------------------------------
// Graceful shutdown
// --------------------------------------------------------------------------
const shutdown = (signal) => {
  console.log(`\n[SERVER] ${signal} received — shutting down gracefully…`);
  httpServer.close(() => {
    console.log("[SERVER] HTTP server closed.");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));