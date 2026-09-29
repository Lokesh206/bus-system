const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../../../data');
const STATE_FILE = path.join(DATA_DIR, 'transit_state_v2.json');

// Memory store backed by atomic snapshot persistence
class TransitRepository {
  constructor() {
    this.mutexes = new Map(); // Trip/Entity level async locks for concurrency
    this.data = {
      terminals: [],
      gates: [],
      routes: [],
      buses: [],
      trips: [],
      seatInventory: {}, // tripId -> { seatNumber -> { state, heldBy, expiresAt, version, passengerId } }
      bookings: [],
      passengers: [],
      tickets: [],
      gateLogs: [],
      telemetry: {},
      payments: [],
      idempotencyKeys: {}
    };
    this.init();
  }

  async acquireLock(key) {
    while (this.mutexes.has(key)) {
      await this.mutexes.get(key);
    }
    let resolveLock;
    const lockPromise = new Promise(resolve => { resolveLock = resolve; });
    this.mutexes.set(key, lockPromise);
    return () => {
      this.mutexes.delete(key);
      resolveLock();
    };
  }

  init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(STATE_FILE)) {
      try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        this.data = JSON.parse(raw);
        console.log('Loaded transit relational repository from disk.');
        return;
      } catch (e) {
        console.warn('Could not parse transit_state_v2.json, re-seeding:', e.message);
      }
    }

    // Seed defaults from existing json data or fallback
    this.seedDefaults();
    this.persist();
  }

  persist() {
    try {
      const tempPath = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempPath, STATE_FILE);
    } catch (err) {
      console.error('Failed to atomically persist transit state:', err);
    }
  }

  seedDefaults() {
    // 1. Terminals & Gates
    this.data.terminals = [
      {
        id: "TERM-MAJESTIC",
        code: "KBS-MAJESTIC",
        name: "Kempegowda Bus Station (Majestic)",
        city: "Bengaluru",
        latitude: 12.9778,
        longitude: 77.5713
      },
      {
        id: "TERM-MYSURU",
        code: "MYS-SUBURBAN",
        name: "Mysuru Suburban Bus Stand",
        city: "Mysuru",
        latitude: 12.3118,
        longitude: 76.6575
      }
    ];

    this.data.gates = [
      { id: "GATE-G1", terminalId: "TERM-MAJESTIC", gateCode: "G1", platform: "Platform 3A", healthStatus: "ONLINE", assignedTripId: "TRIP-KA-01-4821" },
      { id: "GATE-G2", terminalId: "TERM-MAJESTIC", gateCode: "G2", platform: "Platform 2B", healthStatus: "ONLINE", assignedTripId: "TRIP-KA-09-7712" },
      { id: "GATE-G3", terminalId: "TERM-MAJESTIC", gateCode: "G3", platform: "Platform 5", healthStatus: "ONLINE", assignedTripId: "TRIP-KA-19-3305" },
      { id: "GATE-G4", terminalId: "TERM-MAJESTIC", gateCode: "G4", platform: "Platform 6", healthStatus: "ONLINE", assignedTripId: "TRIP-KA-25-8841" }
    ];

    // 2. Routes
    const legacyRoutesPath = path.join(DATA_DIR, 'routes.json');
    if (fs.existsSync(legacyRoutesPath)) {
      try {
        this.data.routes = JSON.parse(fs.readFileSync(legacyRoutesPath, 'utf8'));
      } catch (e) {
        this.data.routes = [];
      }
    }

    // 3. Buses
    const legacyBusesPath = path.join(DATA_DIR, 'buses.json');
    let loadedBuses = [];
    if (fs.existsSync(legacyBusesPath)) {
      try {
        loadedBuses = JSON.parse(fs.readFileSync(legacyBusesPath, 'utf8'));
      } catch (e) {
        loadedBuses = [];
      }
    }

    this.data.buses = loadedBuses.map(b => ({
      id: b.id,
      registrationNo: b.busNumber,
      serviceType: b.serviceType,
      isAc: !!b.isAc,
      capacity: b.totalSeats || 40,
      seatingConfig: "2x2"
    }));

    // 4. Trips & Seat Inventory
    this.data.trips = loadedBuses.map(b => {
      const tripId = `TRIP-${b.id.replace('BUS-', '')}`;
      
      // Initialize trip seat inventory
      this.data.seatInventory[tripId] = {};
      const total = b.totalSeats || 48;
      const rows = Math.max(16, Math.ceil(total / 4));

      for (let r = 1; r <= rows; r++) {
        ['A', 'B', 'C', 'D', 'W'].forEach(col => {
          const seatNum = `${r}${col}`;
          this.data.seatInventory[tripId][seatNum] = {
            seatNumber: seatNum,
            state: 'AVAILABLE', // AVAILABLE, HELD, CONFIRMED, CHECKED_IN, BOARDED, BLOCKED
            heldBy: null,
            holdExpiresAt: null,
            version: 1,
            passengerId: null
          };
        });
      }

      return {
        id: tripId,
        busId: b.id,
        busNumber: b.busNumber,
        routeId: b.routeId,
        routeName: b.routeName,
        serviceType: b.serviceType,
        isAc: !!b.isAc,
        platform: b.platform,
        gate: b.gate,
        scheduledDeparture: b.departureTime || '09:30 AM',
        status: 'SCHEDULED', // SCHEDULED, BOARDING, DEPARTED, DELAYED, CANCELLED
        totalSeats: total
      };
    });

    // 5. Existing tickets & logs
    const legacyTicketsPath = path.join(DATA_DIR, 'tickets.json');
    if (fs.existsSync(legacyTicketsPath)) {
      try {
        this.data.tickets = JSON.parse(fs.readFileSync(legacyTicketsPath, 'utf8'));
      } catch (e) {}
    }

    const legacyLogsPath = path.join(DATA_DIR, 'gateLogs.json');
    if (fs.existsSync(legacyLogsPath)) {
      try {
        this.data.gateLogs = JSON.parse(fs.readFileSync(legacyLogsPath, 'utf8'));
      } catch (e) {}
    }
  }

  // -----------------------------------------------------------
  // CONCURRENT SAFE ATOMIC BOOKING WITH OPTIMISTIC / ROW LOCKS
  // -----------------------------------------------------------
  async executeBookingTransaction({ busId, routeId, passengers, selectedSeats, idempotencyKey, fareResult }) {
    // Idempotency check: Return existing booking if key was already processed
    if (idempotencyKey && this.data.idempotencyKeys[idempotencyKey]) {
      const existingBookingId = this.data.idempotencyKeys[idempotencyKey];
      const existing = this.data.bookings.find(b => b.id === existingBookingId);
      if (existing) {
        return { booking: existing, isDuplicate: true };
      }
    }

    // Find trip matching this bus
    const trip = this.data.trips.find(t => t.busId === busId);
    if (!trip) {
      throw new Error(`Scheduled trip not found for bus ID: ${busId}`);
    }

    const lockKey = `TRIP_LOCK_${trip.id}`;
    const releaseLock = await this.acquireLock(lockKey);

    try {
      const tripInventory = this.data.seatInventory[trip.id] || {};
      const now = Date.now();

      // 1. Check for conflicts or active holds
      for (const seat of selectedSeats) {
        if (!tripInventory[seat]) {
          if (/^\d+[A-Z]$/.test(seat)) {
            tripInventory[seat] = {
              seatNumber: seat,
              state: 'AVAILABLE',
              heldBy: null,
              holdExpiresAt: null,
              version: 1,
              passengerId: null
            };
          } else {
            throw new Error(`Seat ${seat} is not a valid seat on this vehicle layout.`);
          }
        }
        const seatRecord = tripInventory[seat];

        // Clean expired holds on the fly
        if (seatRecord.state === 'HELD' && seatRecord.holdExpiresAt && seatRecord.holdExpiresAt < now) {
          seatRecord.state = 'AVAILABLE';
          seatRecord.heldBy = null;
        }

        if (seatRecord.state !== 'AVAILABLE') {
          throw new Error(`Seat ${seat} is already occupied or held by another passenger. Booking rejected.`);
        }
      }

      // 2. Generate Booking, Passenger and Ticket Records
      const bookingId = `BK-${uuidv4().substring(0, 8).toUpperCase()}`;
      const pnr = `KA${Math.floor(100000 + Math.random() * 900000)}`;
      const issuedTickets = [];
      const passengerEntities = [];

      selectedSeats.forEach((seat, idx) => {
        const pax = passengers[idx] || passengers[0];
        const paxId = `PAX-${uuidv4().substring(0, 8).toUpperCase()}`;
        const ticketId = `KA-KSRTC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

        // Transition Seat State atomically
        tripInventory[seat].state = 'CONFIRMED';
        tripInventory[seat].passengerId = paxId;
        tripInventory[seat].version += 1;

        const paxEntity = {
          id: paxId,
          bookingId,
          name: pax.name,
          age: pax.age,
          gender: pax.gender,
          isKarnatakaResident: !!pax.isKarnatakaResident,
          isShaktiApproved: !!pax.isShaktiApproved,
          assignedSeat: seat,
          fareAmount: fareResult.passengerBreakdowns[idx]?.finalFare || 0
        };
        passengerEntities.push(paxEntity);

        const ticketEntity = {
          id: ticketId,
          ticketId,
          ticketNumber: ticketId,
          bookingId,
          pnr,
          passengerId: paxId,
          passengerName: pax.name,
          tripId: trip.id,
          busId: trip.busId,
          busNumber: trip.busNumber,
          serviceType: trip.serviceType,
          routeName: trip.routeName,
          seatNumber: seat,
          platform: trip.platform,
          gate: trip.gate,
          departureTime: trip.scheduledDeparture,
          isBoarded: false,
          boardedAt: null,
          boardedGateId: null,
          isRevoked: false,
          issuedAt: new Date().toISOString()
        };
        issuedTickets.push(ticketEntity);
      });

      const bookingEntity = {
        id: bookingId,
        pnr,
        tripId: trip.id,
        busId: trip.busId,
        busNumber: trip.busNumber,
        serviceType: trip.serviceType,
        routeName: trip.routeName,
        platform: trip.platform,
        gate: trip.gate,
        departureTime: trip.scheduledDeparture,
        totalAmount: fareResult.totals.totalPayable,
        paymentStatus: 'COMPLETED',
        idempotencyKey: idempotencyKey || null,
        passengers: passengerEntities,
        selectedSeats,
        tickets: issuedTickets,
        fareBreakdown: fareResult,
        status: 'ISSUED',
        createdAt: new Date().toISOString()
      };

      // Save into memory structures
      this.data.bookings.unshift(bookingEntity);
      this.data.passengers.push(...passengerEntities);
      this.data.tickets.unshift(...issuedTickets);

      if (idempotencyKey) {
        this.data.idempotencyKeys[idempotencyKey] = bookingId;
      }

      // Sync legacy buses format for backwards compatibility
      this.syncLegacyBusesState(trip.busId, selectedSeats, passengerEntities, bookingEntity);

      // Persist to disk
      this.persist();

      return { booking: bookingEntity, tickets: issuedTickets };
    } finally {
      releaseLock();
    }
  }

  // -----------------------------------------------------------
  // ATOMIC GATE PASSENGER BOARDING VERIFICATION
  // -----------------------------------------------------------
  async executeGateVerification({ ticketId, tokenPayload, gateBusId, gateId, scanInputType = 'SIMULATOR' }) {
    const lockKey = `TICKET_LOCK_${ticketId}`;
    const releaseLock = await this.acquireLock(lockKey);
    const timestamp = new Date().toISOString();

    try {
      // Find ticket in authoritative storage
      const ticket = this.data.tickets.find(t => t.ticketId === ticketId || t.id === ticketId);
      if (!ticket) {
        return this.recordGateLogEntry({
          gateId: gateId || 'UNKNOWN_GATE',
          tripId: 'UNKNOWN_TRIP',
          ticketId,
          decision: 'DENIED',
          diagnosticCode: 'TICKET_NOT_FOUND',
          details: `Ticket identifier "${ticketId}" does not exist in transit database.`,
          scanInputType,
          timestamp
        });
      }

      if (ticket.isRevoked) {
        return this.recordGateLogEntry({
          gateId: gateId || 'UNKNOWN_GATE',
          tripId: ticket.tripId,
          ticketId,
          decision: 'DENIED',
          diagnosticCode: 'TICKET_REVOKED',
          details: `Ticket ${ticketId} has been cancelled or revoked. Boarding prohibited.`,
          scanInputType,
          timestamp
        });
      }

      // Check Bus / Route Gate Match
      if (gateBusId && ticket.busId !== gateBusId) {
        const assignedBus = this.data.buses.find(b => b.id === ticket.busId);
        const currentGateBus = this.data.buses.find(b => b.id === gateBusId);

        return this.recordGateLogEntry({
          gateId: gateId || 'GATE-G1',
          tripId: ticket.tripId,
          ticketId,
          decision: 'DENIED',
          diagnosticCode: 'WRONG_BUS',
          passengerName: ticket.passengerName,
          ticketBusNumber: assignedBus ? assignedBus.registrationNo : ticket.busNumber,
          gateBusNumber: currentGateBus ? currentGateBus.registrationNo : gateBusId,
          details: `Wrong Bus Gate! Ticket is valid for Bus "${ticket.busNumber}" (${ticket.routeName}), NOT for Gate Bus "${currentGateBus ? currentGateBus.registrationNo : gateBusId}".`,
          scanInputType,
          timestamp
        });
      }

      // Check Passback / Prior Boarding
      if (ticket.isBoarded) {
        return this.recordGateLogEntry({
          gateId: gateId || 'GATE-G1',
          tripId: ticket.tripId,
          ticketId,
          decision: 'DENIED',
          diagnosticCode: 'ALREADY_BOARDED',
          passengerName: ticket.passengerName,
          seat: ticket.seatNumber,
          details: `Access Denied: Ticket already boarded at ${new Date(ticket.boardedAt).toLocaleTimeString()}. Passback / duplicate entry rejected.`,
          scanInputType,
          timestamp
        });
      }

      // ATOMIC ADMISSION GRANTED
      ticket.isBoarded = true;
      ticket.boardedAt = timestamp;
      ticket.boardedGateId = gateId || 'GATE-G1';

      // Update seat inventory state to BOARDED
      const tripInventory = this.data.seatInventory[ticket.tripId];
      if (tripInventory && tripInventory[ticket.seatNumber]) {
        tripInventory[ticket.seatNumber].state = 'BOARDED';
      }

      // Sync legacy bus seats
      const legacyBus = this.data.buses.find(b => b.id === ticket.busId);
      if (legacyBus && legacyBus.seats && legacyBus.seats[ticket.seatNumber]) {
        legacyBus.seats[ticket.seatNumber].status = 'boarded';
      }

      this.persist();

      return this.recordGateLogEntry({
        gateId: gateId || 'GATE-G1',
        tripId: ticket.tripId,
        ticketId: ticket.ticketId,
        pnr: ticket.pnr,
        passengerName: ticket.passengerName,
        seat: ticket.seatNumber,
        busNumber: ticket.busNumber,
        route: ticket.routeName,
        serviceType: ticket.serviceType,
        decision: 'GRANTED',
        diagnosticCode: 'ACCESS_GRANTED',
        details: `Welcome Aboard! Access Granted for ${ticket.passengerName} (Seat ${ticket.seatNumber}).`,
        scanInputType,
        timestamp
      });
    } finally {
      releaseLock();
    }
  }

  recordGateLogEntry(entry) {
    const logItem = {
      id: `LOG-${uuidv4().substring(0, 8).toUpperCase()}`,
      status: entry.decision, // For backwards compatibility
      code: entry.diagnosticCode,
      message: entry.details,
      ...entry
    };

    this.data.gateLogs.unshift(logItem);
    if (this.data.gateLogs.length > 500) {
      this.data.gateLogs.pop();
    }

    this.persist();
    return logItem;
  }

  syncLegacyBusesState(busId, seats, passengers, booking) {
    const bus = this.data.buses.find(b => b.id === busId);
    if (!bus) return;
    bus.seats = bus.seats || {};

    seats.forEach((seat, idx) => {
      bus.seats[seat] = {
        status: 'booked',
        passengerName: passengers[idx] ? passengers[idx].name : 'Passenger',
        ticketId: booking.tickets[idx]?.ticketId || booking.id,
        pnr: booking.pnr
      };
    });
  }

  // Getters
  getRoutes() { return this.data.routes; }
  getBuses() { return this.data.buses; }
  getTrips() { return this.data.trips; }
  getTickets() { return this.data.tickets; }
  getBookings() { return this.data.bookings; }
  getGateLogs() { return this.data.gateLogs; }
  getSeatInventory(tripId) { return this.data.seatInventory[tripId] || {}; }

  resetDemo() {
    this.seedDefaults();
    this.data.bookings = [];
    this.data.passengers = [];
    this.data.tickets = [];
    this.data.gateLogs = [];
    this.data.idempotencyKeys = {};
    this.persist();
    return { success: true, message: 'Transit database and seat inventories reset successfully.' };
  }
}

const transitRepository = new TransitRepository();

module.exports = {
  TransitRepository,
  transitRepository
};
