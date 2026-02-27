/**
 * /routes/brain.js
 *
 * Express router for the /brain endpoint (laptop side).
 *
 * Responsibilities:
 *   - Generate a unique session ID (uuid)
 *   - Resolve the local machine IP
 *   - Generate a QR code pointing to /control?session=SESSION_ID
 *   - Serve brain/index.html injected with session data
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const qrcode  = require('qrcode');
const os      = require('os');
const path    = require('path');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the first non-loopback IPv4 address of this machine.
 * Falls back to 'localhost' if none found.
 */
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ─── GET /brain ───────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // 1. Generate session
    const sessionId = uuidv4();
    const localIp   = getLocalIp();
    const port      = process.env.PORT || 3000;

    // 2. Build control URL (mobile will open this)
    const controlUrl = `http://${localIp}:${port}/control?session=${sessionId}`;

    // 3. Generate QR code as a data URI (base64 PNG)
    const qrDataUri = await qrcode.toDataURL(controlUrl, {
      width:         300,
      margin:        2,
      color: {
        dark:  '#00ffcc',
        light: '#0a0a0f',
      },
    });

    // 4. Send HTML file with injected bootstrap data
    //    We inject a <script> tag so the frontend knows its session + QR.
    const htmlPath = path.join(__dirname, '../public/brain/index.html');

    // Read and inject session data before serving
    const fs = require('fs');
    let html = fs.readFileSync(htmlPath, 'utf-8');

    const injection = `
    <script>
      window.__NEURAL_SESSION__ = {
        sessionId:  "${sessionId}",
        controlUrl: "${controlUrl}",
        qrDataUri:  "${qrDataUri}",
        localIp:    "${localIp}",
        port:        ${port},
      };
    </script>`;

    html = html.replace('</head>', `${injection}\n</head>`);
    res.send(html);

  } catch (err) {
    console.error('[/brain] Error:', err);
    res.status(500).send('Failed to initialize brain session.');
  }
});

module.exports = router;