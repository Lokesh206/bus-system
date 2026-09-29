require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const { defaultTariffEngine } = require('./packages/shared/tariffs');
const { createTransitToken, verifyTransitToken } = require('./packages/shared/securityToken');
const { transitRepository } = require('./apps/api/src/db/transitDb');
const { gpsSimulator, ROUTE_WAYPOINTS } = require('./apps/api/src/services/gpsSimulator');
const { BookingRequestSchema, GateVerifyRequestSchema, GpsTelemetrySchema } = require('./packages/shared/types');
const { generateTicketPdf } = require('./services/pdfGenerator');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Connect Socket.IO to GPS Simulator
gpsSimulator.setSocketIO(io);
if (process.env.GPS_SIMULATOR_ENABLED !== 'false') {
  gpsSimulator.start();
}

// Socket.IO Connection Lifecycle
io.on('connection', (socket) => {
  // Send immediate initial fleet state to newly connected client
  socket.emit('fleet:initial', gpsSimulator.getLiveTelemetry());
  
  socket.on('gate:sensor_event', (event) => {
    // Broadcast turnstile sensor feedback (infrared beam, obstruction) to digital twin
    io.emit('gate:twin_update', event);
  });
});

// -------------------------------------------------------------
// ROUTES & BUSES API (PRESERVED & ENHANCED)
// -------------------------------------------------------------

app.get('/api/routes', (req, res) => {
  try {
    const routes = transitRepository.getRoutes();
    res.json({ success: true, routes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/buses', (req, res) => {
  try {
    const buses = transitRepository.getBuses();
    const trips = transitRepository.getTrips();

    const busesWithStats = buses.map(bus => {
      const trip = trips.find(t => t.busId === bus.id);
      const inventory = trip ? transitRepository.getSeatInventory(trip.id) : {};
      const total = bus.capacity || 40;

      let bookedCount = 0;
      let boardedCount = 0;

      Object.values(inventory).forEach(seat => {
        if (seat.state === 'CONFIRMED' || seat.state === 'CHECKED_IN' || seat.state === 'BOARDED') {
          bookedCount++;
        }
        if (seat.state === 'BOARDED') {
          boardedCount++;
        }
      });

      return {
        id: bus.id,
        busNumber: bus.registrationNo,
        routeId: trip ? trip.routeId : 'route-1',
        routeName: trip ? trip.routeName : 'Karnataka Transit',
        serviceType: bus.serviceType,
        isAc: bus.isAc,
        platform: trip ? trip.platform : 'Platform 1',
        gate: trip ? trip.gate : 'Gate G1',
        departureTime: trip ? trip.scheduledDeparture : '09:30 AM',
        totalSeats: total,
        occupiedSeats: bookedCount,
        boardedSeats: boardedCount,
        availableSeats: Math.max(0, total - bookedCount),
        seats: bus.seats || {}
      };
    });

    res.json({ success: true, buses: busesWithStats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/buses/:id', (req, res) => {
  try {
    const buses = transitRepository.getBuses();
    const bus = buses.find(b => b.id === req.params.id);
    if (!bus) return res.status(404).json({ success: false, error: 'Bus not found' });
    res.json({ success: true, bus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// FARE CALCULATION ENGINE (VERSIONED TARIFFS)
// -------------------------------------------------------------

app.post('/api/fare/calculate', (req, res) => {
  try {
    const { serviceType, distanceKm, tollFee, passengers } = req.body;
    const fare = defaultTariffEngine.calculate({
      serviceType,
      distanceKm: Number(distanceKm) || 100,
      tollFee: Number(tollFee) || 0,
      passengers: passengers || []
    });
    res.json({ success: true, fare });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/fare/rates', (req, res) => {
  res.json({ success: true, tariffSchedule: defaultTariffEngine.getTariffSchedule() });
});

// -------------------------------------------------------------
// ATOMIC BOOKING WITH OPTIMISTIC / ROW CONCURRENCY LOCKS
// -------------------------------------------------------------

app.post('/api/tickets/book', async (req, res) => {
  try {
    // Validate request contract with Zod
    const validation = BookingRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: validation.error.errors.map(e => e.message).join(', ')
      });
    }

    const { busId, routeId, passengers, selectedSeats, idempotencyKey } = validation.data;

    const routes = transitRepository.getRoutes();
    const route = routes.find(r => r.id === routeId);
    if (!route) {
      return res.status(404).json({ success: false, error: 'Route not found' });
    }

    const buses = transitRepository.getBuses();
    const bus = buses.find(b => b.id === busId);
    if (!bus) {
      return res.status(404).json({ success: false, error: 'Bus not found' });
    }

    // Authoritative Fare Calculation
    const fareResult = defaultTariffEngine.calculate({
      serviceType: bus.serviceType,
      distanceKm: route.distanceKm,
      tollFee: route.tollFee,
      passengers
    });

    // Execute Atomic Concurrency Safe Booking Transaction
    const { booking, tickets, isDuplicate } = await transitRepository.executeBookingTransaction({
      busId,
      routeId,
      passengers,
      selectedSeats,
      idempotencyKey,
      fareResult
    });

    // Generate signed transit token and QR code for the primary boarding pass
    const primaryTicket = tickets[0];
    const secureToken = createTransitToken({
      ticketId: primaryTicket.ticketId,
      pnr: booking.pnr,
      busId: bus.id,
      routeId: route.id,
      seatNumber: primaryTicket.seatNumber,
      passengerId: primaryTicket.passengerId
    });

    const qrDataUrl = await QRCode.toDataURL(secureToken, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 6,
      color: { dark: '#111827', light: '#ffffff' }
    });

    // Construct response matching both legacy and 2.0 specs
    const responsePayload = {
      ...booking,
      ticketId: primaryTicket.ticketId,
      qrToken: secureToken,
      qrDataString: secureToken,
      qrDataUrl,
      isDuplicate: !!isDuplicate
    };

    // Broadcast seat occupancy update via WebSockets
    io.emit('inventory:updated', { busId, occupiedSeats: booking.selectedSeats });

    res.status(201).json({ success: true, ticket: responsePayload });
  } catch (err) {
    const isConflict = err.message.includes('occupied') || err.message.includes('held');
    res.status(isConflict ? 409 : 400).json({ success: false, error: err.message });
  }
});

app.get('/api/tickets', (req, res) => {
  try {
    const tickets = transitRepository.getTickets();
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tickets/:id', (req, res) => {
  try {
    const tickets = transitRepository.getTickets();
    const ticket = tickets.find(t => t.ticketId === req.params.id || t.id === req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PDF Generation
app.get('/api/tickets/:id/pdf', async (req, res) => {
  try {
    const tickets = transitRepository.getTickets();
    const ticket = tickets.find(t => t.ticketId === req.params.id || t.id === req.params.id);
    if (!ticket) return res.status(404).send('Ticket not found');

    const bookings = transitRepository.getBookings();
    const booking = bookings.find(b => b.pnr === ticket.pnr) || ticket;

    // Ensure QR image is available for embedding
    const secureToken = ticket.qrToken || createTransitToken({
      ticketId: ticket.ticketId,
      pnr: ticket.pnr,
      busId: ticket.busId,
      routeId: 'route-1',
      seatNumber: ticket.seatNumber,
      passengerId: ticket.passengerId
    });

    const qrDataUrl = await QRCode.toDataURL(secureToken);

    const pdfBytes = await generateTicketPdf({
      ...ticket,
      passengers: booking.passengers || [{ name: ticket.passengerName || 'Passenger', age: 30, gender: 'General' }],
      selectedSeats: booking.selectedSeats || [ticket.seatNumber],
      fareBreakdown: booking.fareBreakdown || { totals: { totalPayable: 400, baseFare: 350, amenityCess: 10, tollCharges: 40, gst: 0 } },
      qrDataUrl
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="KSRTC-Ticket-${ticket.ticketId}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Error generating PDF:', err);
    res.status(500).send('Error generating ticket PDF');
  }
});

// -------------------------------------------------------------
// TURNSTILE GATE VERIFICATION & ACCESS CONTROL
// -------------------------------------------------------------

app.post('/api/gate/verify', async (req, res) => {
  try {
    const validation = GateVerifyRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ success: false, error: validation.error.errors[0].message });
    }

    const { qrData, gateBusId, gateId, scanInputType } = validation.data;

    let ticketIdToVerify = null;
    let tokenPayload = null;

    // 1. Verify Cryptographic Signature
    if (typeof qrData === 'string' && (qrData.startsWith('KST2.') || qrData.startsWith('{'))) {
      const verifyResult = verifyTransitToken(qrData);
      if (!verifyResult.valid) {
        const log = transitRepository.recordGateLogEntry({
          gateId: gateId || 'GATE-G1',
          tripId: 'UNKNOWN',
          decision: 'DENIED',
          diagnosticCode: 'COUNTERFEIT_DETECTED',
          details: `Security Alert: ${verifyResult.error}`,
          scanInputType,
          timestamp: new Date().toISOString()
        });

        io.emit('gate:decision', log);
        return res.json({ success: true, result: log });
      }
      tokenPayload = verifyResult.payload;
      ticketIdToVerify = tokenPayload.tid || tokenPayload.ticketId;
    } else if (typeof qrData === 'object' && qrData !== null) {
      ticketIdToVerify = qrData.ticketId;
    } else {
      ticketIdToVerify = String(qrData).trim();
    }

    // 2. Execute Atomic Gate Verification
    const decisionResult = await transitRepository.executeGateVerification({
      ticketId: ticketIdToVerify,
      tokenPayload,
      gateBusId,
      gateId,
      scanInputType
    });

    // Broadcast gate decision to turnstile twins and conductor dashboards in real-time
    io.emit('gate:decision', decisionResult);

    res.json({ success: true, result: decisionResult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/gate/logs', (req, res) => {
  try {
    const logs = transitRepository.getGateLogs();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/gate/reset', (req, res) => {
  try {
    const result = transitRepository.resetDemo();
    io.emit('system:reset', {});
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// LIVE GPS FLEET TELEMETRY & HIGHWAY POLYLINES
// -------------------------------------------------------------

app.get('/api/fleet/live', (req, res) => {
  res.json({ success: true, telemetry: gpsSimulator.getLiveTelemetry() });
});

app.get('/api/fleet/routes', (req, res) => {
  res.json({ success: true, polylines: ROUTE_WAYPOINTS });
});

// Real-Device Authenticated Ingestion
app.post('/api/fleet/telemetry', (req, res) => {
  const token = req.headers['x-device-token'];
  if (token !== (process.env.DEVICE_INGEST_TOKEN || 'ksrtc_device_telemetry_demo_token')) {
    return res.status(401).json({ success: false, error: 'Unauthorized device token' });
  }

  const validation = GpsTelemetrySchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ success: false, error: validation.error.errors[0].message });
  }

  const payload = { ...validation.data, isSimulated: false, timestamp: new Date().toISOString() };
  io.emit('fleet:telemetry', payload);
  res.json({ success: true, received: payload });
});

// -------------------------------------------------------------
// MULTI-LANGUAGE LOCALIZATION (EN, KN, HI)
// -------------------------------------------------------------

const LOCALIZATION = {
  en: {
    brand: "KSRTC / BMTC Smart Transit",
    subBrand: "Government of Karnataka | Automated Public Transit",
    bookTab: "1. Book Ticket & Fare",
    gateTab: "2. Bus Gate Turnstile Twin",
    manifestTab: "3. Manifest & Audit Logs",
    fleetTab: "4. Live GPS Fleet Tracking",
    shaktiNotice: "Karnataka Shakti Scheme: 100% Free Travel for Women Residents",
    accessGranted: "ACCESS GRANTED",
    accessDenied: "ACCESS DENIED",
    welcomeAboard: "WELCOME ABOARD!"
  },
  kn: {
    brand: "ಕೆ.ಎಸ್.ಆರ್.ಟಿ.ಸಿ / ಬಿ.ಎಂ.ಟಿ.ಸಿ ಸ್ಮಾರ್ಟ್ ಸಾರಿಗೆ",
    subBrand: "ಕರ್ನಾಟಕ ಸರ್ಕಾರ | ಸ್ವಯಂಚಾಲಿತ ಸಾರ್ವಜನಿಕ ಸಾರಿಗೆ ವ್ಯವಸ್ಥೆ",
    bookTab: "೧. ಟಿಕೆಟ್ ಬುಕಿಂಗ್ ಮತ್ತು ದರ",
    gateTab: "೨. ಬಸ್ ಗೇಟ್ ಟರ್ನ್‌ಸ್ಟೈಲ್ ಟ್ವಿನ್",
    manifestTab: "೩. ಪ್ರಯಾಣಿಕರ ಪಟ್ಟಿ ಮತ್ತು ದಾಖಲೆ",
    fleetTab: "೪. ಲೈವ್ ಜಿಪಿಎಸ್ ಬಸ್ ಟ್ರ್ಯಾಕಿಂಗ್",
    shaktiNotice: "ಕರ್ನಾಟಕ ಶಕ್ತಿ ಯೋಜನೆ: ರಾಜ್ಯದ ಮಹಿಳೆಯರಿಗೆ ಉಚಿತ ಪ್ರಯಾಣ",
    accessGranted: "ಪ್ರವೇಶ ಅನುಮೋದಿಸಲಾಗಿದೆ",
    accessDenied: "ಪ್ರವೇಶ ನಿರಾಕರಿಸಲಾಗಿದೆ",
    welcomeAboard: "ಸುಸ್ವಾಗತ!"
  },
  hi: {
    brand: "केएसआरटीसी / बीएमटीसी स्मार्ट ट्रांजिट",
    subBrand: "कर्नाटक सरकार | स्वचालित सार्वजनिक परिवहन प्रणाली",
    bookTab: "१. टिकट बुकिंग और किराया",
    gateTab: "२. बस गेट टर्नस्टाइल ट्विन",
    manifestTab: "३. यात्री सूची और ऑडिट लॉग",
    fleetTab: "४. लाइव जीपीएस बस ट्रैकिंग",
    shaktiNotice: "कर्नाटक शक्ति योजना: महिला यात्रियों के लिए निःशुल्क यात्रा",
    accessGranted: "प्रवेश स्वीकृत",
    accessDenied: "प्रवेश अस्वीकृत",
    welcomeAboard: "शुभ यात्रा!"
  }
};

app.get('/api/i18n/:lang', (req, res) => {
  const lang = req.params.lang || 'en';
  res.json({ success: true, lang, strings: LOCALIZATION[lang] || LOCALIZATION.en });
});

// Start HTTP + Socket.IO Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Karnataka Smart Transit 2.0 Online on Port ${PORT}!   `);
  console.log(` Web Dashboard: http://localhost:${PORT}               `);
  console.log(` WebSockets: Socket.IO Gateway Ready                   `);
  console.log(` GPS Simulator: Live Highway Trajectories Active       `);
  console.log(`=======================================================`);
});

module.exports = { app, server };
