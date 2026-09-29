const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { calculateFare, FARE_RATES } = require('./services/fareCalculator');
const {
  loadBuses,
  saveBuses,
  loadTickets,
  saveTickets,
  bookTicket,
  getTicketById,
  getAllTickets
} = require('./services/ticketService');
const { verifyGateScan, loadGateLogs, resetDemoData } = require('./services/gateService');
const { generateTicketPdf } = require('./services/pdfGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper to load routes
function loadRoutes() {
  const routesPath = path.join(__dirname, 'data/routes.json');
  return JSON.parse(fs.readFileSync(routesPath, 'utf8') || '[]');
}

// -------------------------------------------------------------
// ROUTES & BUSES API
// -------------------------------------------------------------

// Get all routes
app.get('/api/routes', (req, res) => {
  try {
    const routes = loadRoutes();
    res.json({ success: true, routes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all buses (with seat counts & status)
app.get('/api/buses', (req, res) => {
  try {
    const buses = loadBuses();
    const busesWithStats = buses.map(bus => {
      const seats = bus.seats || {};
      const total = bus.totalSeats || 40;
      let bookedCount = 0;
      let boardedCount = 0;

      Object.values(seats).forEach(s => {
        if (s.status === 'booked') bookedCount++;
        if (s.status === 'boarded') {
          bookedCount++;
          boardedCount++;
        }
      });

      return {
        ...bus,
        occupiedSeats: bookedCount,
        boardedSeats: boardedCount,
        availableSeats: total - bookedCount
      };
    });

    res.json({ success: true, buses: busesWithStats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get specific bus with its real-time seating map
app.get('/api/buses/:id', (req, res) => {
  try {
    const buses = loadBuses();
    const bus = buses.find(b => b.id === req.params.id);
    if (!bus) return res.status(404).json({ success: false, error: 'Bus not found' });
    res.json({ success: true, bus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// FARE CALCULATION & BOOKING API
// -------------------------------------------------------------

// Fare calculation endpoint
app.post('/api/fare/calculate', (req, res) => {
  try {
    const { serviceType, distanceKm, tollFee, passengers } = req.body;
    const fare = calculateFare({
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

// Get fare rate card
app.get('/api/fare/rates', (req, res) => {
  res.json({ success: true, rates: FARE_RATES });
});

// Book a ticket
app.post('/api/tickets/book', async (req, res) => {
  try {
    const { busId, routeId, passengers, selectedSeats } = req.body;

    if (!busId || !routeId || !passengers || !selectedSeats || selectedSeats.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required booking fields (busId, routeId, passengers, selectedSeats).'
      });
    }

    if (passengers.length !== selectedSeats.length) {
      return res.status(400).json({
        success: false,
        error: `Number of passengers (${passengers.length}) must match selected seats (${selectedSeats.length}).`
      });
    }

    const routes = loadRoutes();
    const route = routes.find(r => r.id === routeId);
    if (!route) {
      return res.status(404).json({ success: false, error: 'Route not found' });
    }

    const ticket = await bookTicket({ busId, route, passengers, selectedSeats });
    res.status(201).json({ success: true, ticket });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get all tickets
app.get('/api/tickets', (req, res) => {
  try {
    const tickets = getAllTickets();
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get ticket by ID
app.get('/api/tickets/:id', (req, res) => {
  try {
    const ticket = getTicketById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download ticket PDF
app.get('/api/tickets/:id/pdf', async (req, res) => {
  try {
    const ticket = getTicketById(req.params.id);
    if (!ticket) return res.status(404).send('Ticket not found');

    const pdfBytes = await generateTicketPdf(ticket);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="KSRTC-Ticket-${ticket.ticketId}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Error generating PDF:', err);
    res.status(500).send('Error generating ticket PDF');
  }
});

// -------------------------------------------------------------
// BUS TURNSTILE & GATE SCANNER API
// -------------------------------------------------------------

// Verify ticket QR code scan at boarding gate
app.post('/api/gate/verify', async (req, res) => {
  try {
    const { qrData, gateBusId } = req.body;
    if (!qrData) {
      return res.status(400).json({ success: false, error: 'qrData is required' });
    }

    const result = await verifyGateScan({ qrData, gateBusId });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get gate activity audit logs
app.get('/api/gate/logs', (req, res) => {
  try {
    const logs = loadGateLogs();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset demo simulation data
app.post('/api/gate/reset', (req, res) => {
  try {
    const result = resetDemoData();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Karnataka Bus Ticketing & Gate Control System Online! `);
  console.log(` Access URL: http://localhost:${PORT}                  `);
  console.log(`=======================================================`);
});

