const crypto = require('crypto');

// Server-side keystore supporting key rotation
const KEY_STORE = {
  '2026-Q3-PRIMARY': process.env.TRANSIT_TOKEN_SECRET || 'ksrtc_secure_smart_transit_secret_key_prod_v2_9f83a04c',
  '2026-LEGACY-V1': process.env.TRANSIT_TOKEN_PREV_SECRET || 'KSRTC_SECURE_TRANSIT_PASS_KEY_2026'
};

const ACTIVE_KEY_ID = process.env.ACTIVE_KEY_ID || '2026-Q3-PRIMARY';

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Creates a cryptographically signed compact transit boarding pass token.
 * 
 * @param {Object} params
 * @param {string} params.ticketId - Ticket ID
 * @param {string} params.pnr - PNR Number
 * @param {string} params.busId - Vehicle ID
 * @param {string} params.routeId - Route ID
 * @param {string} params.seatNumber - Specific assigned seat
 * @param {string} params.passengerId - Specific passenger entitlement ID
 * @param {number} [params.validityHours=24] - Token validity duration
 * @returns {string} Compact signed token (e.g. KST2.<keyId>.<payload>.<signature>)
 */
function createTransitToken({ ticketId, pnr, busId, routeId, seatNumber, passengerId, validityHours = 24 }) {
  const secret = KEY_STORE[ACTIVE_KEY_ID];
  if (!secret) {
    throw new Error(`Active token key ${ACTIVE_KEY_ID} not configured in keystore`);
  }

  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString('hex');

  const payload = {
    tid: ticketId,
    pnr,
    bid: busId,
    rid: routeId,
    sid: seatNumber,
    pid: passengerId,
    iat: now,
    exp: now + (validityHours * 3600),
    nonce
  };

  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = `KST2.${ACTIVE_KEY_ID}.${payloadEncoded}`;

  const signature = crypto.createHmac('sha256', secret)
    .update(dataToSign)
    .digest('hex');

  return `${dataToSign}.${signature}`;
}

/**
 * Verifies a token string using constant-time cryptographic comparison.
 * 
 * @param {string} tokenString
 * @returns {{ valid: boolean, payload?: Object, error?: string }}
 */
function verifyTransitToken(tokenString) {
  if (!tokenString || typeof tokenString !== 'string') {
    return { valid: false, error: 'Token string is empty or invalid type' };
  }

  // Handle compact KST2 token format
  if (tokenString.startsWith('KST2.')) {
    const parts = tokenString.split('.');
    if (parts.length !== 4) {
      return { valid: false, error: 'Malformed token structure' };
    }

    const [prefix, keyId, payloadEncoded, signature] = parts;
    const secret = KEY_STORE[keyId];
    if (!secret) {
      return { valid: false, error: `Unknown or expired key identifier: ${keyId}` };
    }

    const dataToVerify = `${prefix}.${keyId}.${payloadEncoded}`;
    const expectedSig = crypto.createHmac('sha256', secret)
      .update(dataToVerify)
      .digest('hex');

    // Constant-time signature comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSig, 'hex');

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false, error: 'Cryptographic signature mismatch! Counterfeit or altered token' };
    }

    try {
      const payload = JSON.parse(base64UrlDecode(payloadEncoded));
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && now > payload.exp) {
        return { valid: false, error: 'Token has expired', payload };
      }

      return { valid: true, payload };
    } catch (e) {
      return { valid: false, error: 'Unreadable token payload' };
    }
  }

  // Backwards compatibility for Legacy JSON format with sig field
  try {
    const legacy = typeof tokenString === 'string' ? JSON.parse(tokenString) : tokenString;
    if (legacy && legacy.ticketId && legacy.sig) {
      const secret = KEY_STORE['2026-LEGACY-V1'] || KEY_STORE['2026-Q3-PRIMARY'];
      const seats = Array.isArray(legacy.seats) ? legacy.seats : [legacy.seat || ''];
      const content = `${legacy.ticketId}:${legacy.pnr}:${legacy.busId}:${seats.sort().join(',')}`;
      const expected = crypto.createHmac('sha256', secret).update(content).digest('hex').substring(0, 16);
      
      if (expected === legacy.sig) {
        return {
          valid: true,
          payload: {
            tid: legacy.ticketId,
            pnr: legacy.pnr,
            bid: legacy.busId,
            sid: seats[0],
            isLegacy: true
          }
        };
      } else {
        return { valid: false, error: 'Legacy signature invalid' };
      }
    }
  } catch (e) {
    // Not legacy JSON
  }

  return { valid: false, error: 'Unrecognized token format' };
}

module.exports = {
  createTransitToken,
  verifyTransitToken,
  KEY_STORE,
  ACTIVE_KEY_ID
};
