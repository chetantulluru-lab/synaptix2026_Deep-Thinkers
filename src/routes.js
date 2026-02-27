/**
 * routes.js
 * Defines all HTTP REST endpoints exposed by the Express application.
 */

const { Router }         = require("express");
const { generateAttack } = require("./attackGenerator");

const router = Router();

// --------------------------------------------------------------------------
// GET /health
// Simple liveness probe — useful for Docker / k8s health checks.
// --------------------------------------------------------------------------
router.get("/health", (_req, res) => {
  res.json({
    status:    "ok",
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// --------------------------------------------------------------------------
// GET /attack/simulate
// Returns a single on-demand attack event (handy for manual testing).
// --------------------------------------------------------------------------
router.get("/attack/simulate", (_req, res) => {
  const attack = generateAttack();
  res.json({ type: "ATTACK", data: attack });
});

// --------------------------------------------------------------------------
// GET /info
// Returns meta-information about available WebSocket events.
// --------------------------------------------------------------------------
router.get("/info", (_req, res) => {
  res.json({
    websocket: {
      url:            "ws://localhost:<PORT>",
      events: {
        CONNECTED: "Sent once on initial connection.",
        ATTACK:    "Broadcast every 3 s with a simulated cyber-attack payload.",
      },
      attackSchema: {
        id:          "string  — unique event identifier",
        sourceIP:    "string  — attacker IPv4 address",
        country:     "string  — origin country name",
        countryCode: "string  — ISO 3166-1 alpha-2 code",
        attackType:  "DDoS | Malware | Phishing | Ransomware",
        threatLevel: "LOW | MEDIUM | HIGH",
        timestamp:   "string  — ISO 8601 UTC timestamp",
      },
    },
  });
});

module.exports = router;