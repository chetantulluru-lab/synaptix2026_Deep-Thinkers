/**
 * attackGenerator.js
 * Responsible for generating randomised, realistic-looking cyber attack events.
 */

// --- Data pools ---

const COUNTRIES = [
  { name: "Russia",        code: "RU" },
  { name: "China",         code: "CN" },
  { name: "North Korea",   code: "KP" },
  { name: "Iran",          code: "IR" },
  { name: "United States", code: "US" },
  { name: "Brazil",        code: "BR" },
  { name: "Germany",       code: "DE" },
  { name: "India",         code: "IN" },
  { name: "Nigeria",       code: "NG" },
  { name: "Ukraine",       code: "UA" },
];

const ATTACK_TYPES = ["DDoS", "Malware", "Phishing", "Ransomware"];

const THREAT_LEVELS = ["LOW", "MEDIUM", "HIGH"];

// Weighted distribution so HIGH threats are less frequent (adds realism)
const THREAT_WEIGHTS = [0.40, 0.40, 0.20]; // LOW, MEDIUM, HIGH

// --- Utility helpers ---

/**
 * Returns a random integer between min and max (inclusive).
 */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Picks a random element from an array.
 */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Picks a threat level using the weighted distribution defined above.
 */
const pickWeightedThreat = () => {
  const roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < THREAT_LEVELS.length; i++) {
    cumulative += THREAT_WEIGHTS[i];
    if (roll < cumulative) return THREAT_LEVELS[i];
  }
  return THREAT_LEVELS[THREAT_LEVELS.length - 1];
};

/**
 * Generates a random IPv4 address, avoiding reserved ranges.
 */
const randomIP = () => {
  // First octet skips 0, 10, 127, 172, 192 (private / loopback) for realism
  const reserved = new Set([0, 10, 127, 172, 192]);
  let first;
  do { first = randInt(1, 254); } while (reserved.has(first));
  return `${first}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;
};

// --- Main export ---

/**
 * Builds and returns a single cyber attack event object.
 * @returns {Object} attack
 */
const generateAttack = () => {
  const country = pick(COUNTRIES);

  return {
    id:          `atk_${Date.now()}_${randInt(1000, 9999)}`,  // unique event ID
    sourceIP:    randomIP(),
    country:     country.name,
    countryCode: country.code,
    attackType:  pick(ATTACK_TYPES),
    threatLevel: pickWeightedThreat(),
    timestamp:   new Date().toISOString(),
  };
};

module.exports = { generateAttack };