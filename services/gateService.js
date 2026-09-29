const fs = require('fs');
const path = require('path');
const { loadTickets, saveTickets, loadBuses, saveBuses, verifySignature } = require('./ticketService');

const LOGS_FILE = path.join(__dirname, '../data/gateLogs.json');

function loadGateLogs() {
  try {
    if (!fs.existsSync(LOGS_FILE)) return [];
    const data = fs.readFileSync(LOGS_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error loading gate logs:', err);
    return [];
  }
}

function saveGateLogs(logs) {
  fs.writeFileSync(LOGS_FILE, JSON.stringify(logs.slice(0, 200), null, 2), 'utf8'); // Keep recent 200
}

/**
 * Verifies a scanned QR code at the bus boarding gate.
 * 
 * @param {Object} params
 * @param {string|Object} params.qrData - Scanned QR payload (JSON string or object)
 * @param {string} params.gateBusId - The bus assigned to this physical boarding gate
 * @returns {Object} Access decision with detailed diagnostics
 */
async function verifyGateScan({ qrData, gateBusId }) {
  const timestamp = new Date().toISOString();
  let payload;

  // 1. Parse QR payload
  if (typeof qrData === 'string') {
    try {
      payload = JSON.parse(qrData);
    } catch (e) {
      // Maybe it was just a raw ticketId string
      payload = { ticketId: qrData.trim() };
    }
  } else if (typeof qrData === 'object' && qrData !== null) {
    payload = qrData;
  } else {
    return recordGateLog({
      status: 'DENIED',
      code: 'MALFORMED_DATA',
      message: 'Unreadable QR data or camera decoding error.',
      gateBusId,
      timestamp
    });
  }

  const { ticketId, sig } = payload;
  if (!ticketId) {
    return recordGateLog({
      status: 'DENIED',
      code: 'MISSING_TICKET_ID',
      message: 'QR Code does not contain a valid transit ticket identifier.',
      gateBusId,
      timestamp
    });
  }

  // 2. Fetch ticket from registry
  const tickets = loadTickets();
  const ticketIndex = tickets.findIndex(t => t.ticketId === ticketId);
  if (ticketIndex === -1) {
    return recordGateLog({
      status: 'DENIED',
      code: 'TICKET_NOT_FOUND',
      message: `Ticket ID "${ticketId}" was not found in KSRTC central database.`,
      ticketId,
      gateBusId,
      timestamp
    });
  }

  const ticket = tickets[ticketIndex];

  // 3. Verify Cryptographic Signature
  if (sig && !verifySignature(ticket.ticketId, ticket.pnr, ticket.busId, ticket.selectedSeats, sig)) {
    return recordGateLog({
      status: 'DENIED',
      code: 'COUNTERFEIT_DETECTED',
      message: 'Security Alert: QR digital signature is invalid! Counterfeit ticket suspected.',
      ticketId,
      pnr: ticket.pnr,
      gateBusId,
      timestamp
    });
  }

  // 4. Verify Bus & Gate Match
  const buses = loadBuses();
  const gateBus = buses.find(b => b.id === gateBusId);

  if (gateBusId && ticket.busId !== gateBusId) {
    return recordGateLog({
      status: 'DENIED',
      code: 'WRONG_BUS',
      message: `Wrong Bus Gate! Ticket is valid for Bus "${ticket.busNumber}" (${ticket.routeName}), NOT for Gate Bus "${gateBus ? gateBus.busNumber : gateBusId}".`,
      ticketId,
      pnr: ticket.pnr,
      passengerName: ticket.passengers[0]?.name,
      ticketBusNumber: ticket.busNumber,
      gateBusNumber: gateBus ? gateBus.busNumber : gateBusId,
      gateBusId,
      timestamp
    });
  }

  // 5. Verify Boarding Status (Passback / Duplicate prevention)
  if (ticket.boardedCount >= ticket.totalPassengers) {
    const lastScan = ticket.boardedHistory[ticket.boardedHistory.length - 1];
    return recordGateLog({
      status: 'DENIED',
      code: 'ALREADY_USED',
      message: `Access Denied: Ticket already fully used! Passenger(s) already boarded at ${new Date(lastScan ? lastScan.timestamp : ticket.issuedAt).toLocaleTimeString()}. Re-entry is prohibited.`,
      ticketId,
      pnr: ticket.pnr,
      passengerName: ticket.passengers.map(p => p.name).join(', '),
      alreadyBoardedCount: ticket.boardedCount,
      totalPassengers: ticket.totalPassengers,
      gateBusId,
      timestamp
    });
  }

  // 6. ACCESS GRANTED
  ticket.boardedCount = (ticket.boardedCount || 0) + 1;
  const currentPaxIdx = ticket.boardedCount - 1;
  const currentPax = ticket.passengers[currentPaxIdx] || ticket.passengers[0];
  const assignedSeat = ticket.selectedSeats[currentPaxIdx] || ticket.selectedSeats[0];

  ticket.boardedHistory.push({
    timestamp,
    passengerIndex: currentPaxIdx + 1,
    passengerName: currentPax.name,
    seat: assignedSeat,
    gateBusId
  });

  if (ticket.boardedCount >= ticket.totalPassengers) {
    ticket.status = 'BOARDED';
  } else {
    ticket.status = 'PARTIALLY_BOARDED';
  }

  tickets[ticketIndex] = ticket;
  saveTickets(tickets);

  // Update Bus Seating Status to "boarded"
  const busIdx = buses.findIndex(b => b.id === ticket.busId);
  if (busIdx !== -1) {
    buses[busIdx].seats = buses[busIdx].seats || {};
    if (buses[busIdx].seats[assignedSeat]) {
      buses[busIdx].seats[assignedSeat].status = 'boarded';
      buses[busIdx].seats[assignedSeat].boardedAt = timestamp;
    }
    saveBuses(buses);
  }

  return recordGateLog({
    status: 'GRANTED',
    code: 'ACCESS_GRANTED',
    message: `Welcome Aboard! Access Granted for ${currentPax.name} (Seat ${assignedSeat}). [Passenger ${ticket.boardedCount}/${ticket.totalPassengers}]`,
    ticketId: ticket.ticketId,
    pnr: ticket.pnr,
    passengerName: currentPax.name,
    seat: assignedSeat,
    busNumber: ticket.busNumber,
    route: ticket.routeName,
    serviceType: ticket.serviceType,
    boardedCount: ticket.boardedCount,
    totalPassengers: ticket.totalPassengers,
    isShakti: currentPax.isShaktiApproved || ticket.qrPayload.isShakti,
    gateBusId,
    timestamp
  });
}

function recordGateLog(entry) {
  const logs = loadGateLogs();
  logs.unshift(entry);
  saveGateLogs(logs);
  return entry;
}

/**
 * Resets bus demo data (clears boarded status for fresh testing)
 */
function resetDemoData() {
  const buses = loadBuses();
  buses.forEach(b => {
    b.seats = {};
  });
  saveBuses(buses);

  const tickets = loadTickets();
  tickets.forEach(t => {
    t.boardedCount = 0;
    t.boardedHistory = [];
    t.status = 'ISSUED';
  });
  saveTickets(tickets);

  saveGateLogs([]);
  return { success: true, message: 'All bus seats and ticket access records have been reset for testing.' };
}

module.exports = {
  loadGateLogs,
  verifyGateScan,
  resetDemoData
};

