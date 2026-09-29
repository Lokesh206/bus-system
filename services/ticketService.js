const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { calculateFare } = require('./fareCalculator');

const TICKETS_FILE = path.join(__dirname, '../data/tickets.json');
const BUSES_FILE = path.join(__dirname, '../data/buses.json');
const SECRET_KEY = 'KSRTC_SECURE_TRANSIT_PASS_KEY_2026';

function loadTickets() {
  try {
    if (!fs.existsSync(TICKETS_FILE)) return [];
    const data = fs.readFileSync(TICKETS_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error loading tickets:', err);
    return [];
  }
}

function saveTickets(tickets) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2), 'utf8');
}

function loadBuses() {
  try {
    if (!fs.existsSync(BUSES_FILE)) return [];
    const data = fs.readFileSync(BUSES_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error loading buses:', err);
    return [];
  }
}

function saveBuses(buses) {
  fs.writeFileSync(BUSES_FILE, JSON.stringify(buses, null, 2), 'utf8');
}

/**
 * Generate a digital HMAC signature for a ticket payload
 */
function generateSignature(ticketId, pnr, busId, seats) {
  const content = `${ticketId}:${pnr}:${busId}:${seats.sort().join(',')}`;
  return crypto.createHmac('sha256', SECRET_KEY).update(content).digest('hex').substring(0, 16);
}

/**
 * Verify if the signature in a QR payload is authentic
 */
function verifySignature(ticketId, pnr, busId, seats, signature) {
  const expected = generateSignature(ticketId, pnr, busId, seats);
  return expected === signature;
}

/**
 * Books a ticket and reserves seats on the bus.
 */
async function bookTicket({ busId, route, passengers, selectedSeats }) {
  const buses = loadBuses();
  const bus = buses.find(b => b.id === busId);
  if (!bus) {
    throw new Error('Bus not found with ID: ' + busId);
  }

  // Check seat availability
  bus.seats = bus.seats || {};
  for (const seat of selectedSeats) {
    if (bus.seats[seat] && bus.seats[seat].status !== 'available') {
      throw new Error(`Seat ${seat} is already occupied or booked.`);
    }
  }

  // Calculate fare
  const fareResult = calculateFare({
    serviceType: bus.serviceType,
    distanceKm: route.distanceKm,
    tollFee: route.tollFee,
    passengers
  });

  const timestamp = Date.now();
  const randomSuffix = Math.floor(10000 + Math.random() * 90000);
  const ticketId = `KA-KSRTC-${new Date().getFullYear()}-${randomSuffix}`;
  const pnr = `KA${Math.floor(100000 + Math.random() * 900000)}`;

  const signature = generateSignature(ticketId, pnr, bus.id, selectedSeats);

  // Compact QR Payload for quick camera reading
  const qrPayload = {
    ticketId,
    pnr,
    busId: bus.id,
    busNumber: bus.busNumber,
    route: route.name,
    seats: selectedSeats,
    paxCount: passengers.length,
    paxNames: passengers.map(p => p.name),
    departureTime: bus.departureTime,
    totalFare: fareResult.totals.totalPayable,
    isShakti: passengers.some(p => p.isShaktiScheme || p.isKarnatakaResident),
    issuedAt: new Date().toISOString(),
    sig: signature
  };

  const qrDataString = JSON.stringify(qrPayload);
  const qrDataUrl = await QRCode.toDataURL(qrDataString, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 6,
    color: {
      dark: '#111827',
      light: '#ffffff'
    }
  });

  const newTicket = {
    id: ticketId,
    ticketId,
    pnr,
    busId: bus.id,
    busNumber: bus.busNumber,
    serviceType: bus.serviceType,
    platform: bus.platform,
    gate: bus.gate,
    departureTime: bus.departureTime,
    routeName: route.name,
    source: route.source,
    destination: route.destination,
    distanceKm: route.distanceKm,
    passengers,
    selectedSeats,
    fareBreakdown: fareResult,
    status: 'ISSUED', // ISSUED, PARTIALLY_BOARDED, BOARDED, CANCELLED
    boardedCount: 0,
    totalPassengers: passengers.length,
    boardedHistory: [],
    qrPayload,
    qrDataString,
    qrDataUrl,
    issuedAt: new Date().toISOString()
  };

  // Update bus seats
  selectedSeats.forEach((seat, idx) => {
    bus.seats[seat] = {
      status: 'booked',
      passengerName: passengers[idx] ? passengers[idx].name : passengers[0].name,
      ticketId,
      pnr
    };
  });

  // Save changes
  const tickets = loadTickets();
  tickets.unshift(newTicket); // Add to beginning
  saveTickets(tickets);
  saveBuses(buses);

  return newTicket;
}

function getTicketById(ticketId) {
  const tickets = loadTickets();
  return tickets.find(t => t.ticketId === ticketId || t.id === ticketId);
}

function getAllTickets() {
  return loadTickets();
}

module.exports = {
  loadTickets,
  saveTickets,
  loadBuses,
  saveBuses,
  generateSignature,
  verifySignature,
  bookTicket,
  getTicketById,
  getAllTickets
};

