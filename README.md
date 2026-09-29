# Karnataka Smart Transit 2.0
### AI-Powered Bus Ticketing, Real-Time Fleet Tracking, Secure QR Boarding & Intelligent Turnstile Access Control

> **Disclaimer**: This is an independent educational simulation prototype inspired by Karnataka public transportation (KSRTC & BMTC). It is not an official government application. All vehicle numbers, route schedules, and tariffs are demonstration inputs for testing and simulation purposes.

---

## 🌟 Upgraded Architecture & Working Modules (Phase 1)

1. **Versioned Transit Tariff Engine (`packages/shared/tariffs.js`)**:
   - Four configurable service classes: *Karnataka Sarige*, *Rajahamsa*, *Airavat Club Class*, and *EV Power Plus*.
   - Configurable rate cards (`config/tariffs.v1.json`) with minimum fares, passenger cess, highway tolls, and applicable AC GST.
   - **Karnataka Shakti Scheme**: 100% free travel waiver on base fare and cess for eligible female Karnataka residents on ordinary express services (*Karnataka Sarige*).
   - Senior Citizen (25% discount) and Child (50% discount) concessions.

2. **Atomic Seat Inventory & Concurrency Locking (`apps/api/src/db/transitDb.js`)**:
   - Trip-specific seat inventories with explicit states: `AVAILABLE`, `HELD`, `CONFIRMED`, `CHECKED_IN`, `BOARDED`, `BLOCKED`.
   - **Concurrency race condition prevention**: Async row-level mutex locks guarantee that if two users attempt to book the exact same seat at the same millisecond, exactly one succeeds and the other receives a clean `409 Conflict` error without seat corruption.
   - Idempotent booking handling using client-supplied UUID idempotency keys.

3. **Cryptographic Transit Token Engine (`packages/shared/securityToken.js`)**:
   - Server-side signing using HMAC-SHA256 with key rotation support (`ACTIVE_KEY_ID: 2026-Q3-PRIMARY`).
   - Compact token format: `KST2.<keyId>.<payload>.<signature>` with embedded expiration, random nonces, and seat/passenger entitlement scoping.
   - Evaluated using constant-time cryptographic equality (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.

4. **Live OpenStreetMap Fleet Tracking (`apps/api/src/services/gpsSimulator.js`)**:
   - Real-time highway waypoints and trajectories along major Karnataka corridors (Bengaluru $\leftrightarrow$ Mysuru, Bengaluru $\leftrightarrow$ Mangaluru).
   - Broadcasts real-time coordinates, heading degrees, speed (km/h), next stop name, remaining distance, and ETA via WebSockets (Socket.IO).
   - Interactive Leaflet.js map with custom bus markers that rotate smoothly to match vehicle heading.
   - Authenticated real-device location ingestion API (`POST /api/fleet/telemetry`).

5. **Turnstile Digital Twin Simulation (`public/index.html`, `public/app.js`)**:
   - Motorized barrier flaps with 3D CSS swing animations.
   - Status indicators: `ACCESS GRANTED`, `ALREADY BOARDED`, `WRONG BUS`, `COUNTERFEIT DETECTED`.
   - **Physical Sensor Emulation**:
     - *Break IR Beam*: Simulates passenger walking through passage zone, automatically securing flaps.
     - *Sensor Obstruction*: Detects obstruction or tailgating, sounding an alert buzzer.
     - *Emergency Egress*: Failsafe override swinging both flaps open for unrestricted terminal evacuation.
   - Synthesized Web Audio chimes and rejection buzzers without external audio file dependencies.

6. **Relational Database Model (`prisma/schema.prisma`)**:
   - 15 relational entities modeled in PostgreSQL-compliant Prisma schema:
     `Terminal`, `Gate`, `Route`, `RouteStop`, `Bus`, `Trip`, `SeatInventory`, `Booking`, `Passenger`, `Ticket`, `Payment`, `GateScanLog`, `GpsTelemetry`, `DisruptionEvent`, `User`.
   - Complete `docker-compose.yml` for PostgreSQL 16 + Redis 7 deployment.

7. **Multi-Language Localization (`/api/i18n/:lang`)**:
   - Full support for English, Kannada (**ಕನ್ನಡ**), and Hindi (**हिंदी**).

---

## 🚀 How to Run the Platform

The server is active and running locally at:
👉 **[http://localhost:3000](http://localhost:3000)**

### Quick Start:
```powershell
cd "c:\Users\Lenovo\Desktop\bus system"
npm install
npm start
```

### Seeding Sample Transit Data:
```powershell
node scripts/seed.js
```

### Running Automated Test Suite:
```powershell
npm test
```
Tests verify:
- Versioned tariff computation & Shakti Scheme waiver.
- Concurrent simultaneous seat booking race condition (zero double-booking).
- Cryptographic token generation & tamper detection.
- Gate access control: 1st scan granted, duplicate re-scan denied (`ALREADY_BOARDED`).
- Gate wrong bus rejection (`WRONG_BUS`).
- Live GPS fleet telemetry generation.

---

## 📂 Project Directory Structure

```
bus-system/
├── apps/
│   ├── api/                     # Node.js + Express + Socket.IO REST & WebSocket API
│   │   └── src/
│   │       ├── db/              # Relational repository with atomic row-level mutex locks
│   │       └── services/        # GPS fleet telemetry simulator & highway waypoints
│   └── web/                     # Frontend client dashboard (HTML5, Tailwind, Leaflet, Web Audio)
├── packages/
│   └── shared/                  # Domain contracts, Zod schemas, versioned tariffs, cryptographic tokens
│       ├── types.js             # Zod validation schemas for booking, gates, telemetry
│       ├── tariffs.js           # Configurable tariff engine with Shakti Scheme logic
│       └── securityToken.js     # HMAC-SHA256 compact token signing & verification
├── prisma/
│   └── schema.prisma            # Production PostgreSQL relational schema (15 entities)
├── config/
│   └── tariffs.v1.json          # Versioned, configurable tariff rate cards and concession policies
├── scripts/
│   └── seed.js                  # Deterministic database seeding script
├── tests/
│   └── smartTransit2.test.js    # Concurrency races, security tokens, gate access, and GPS tests
├── docs/
│   ├── architecture.md          # Architecture & Database ER diagram
│   └── api_contracts.md         # REST & WebSocket API specifications
├── docker-compose.yml           # PostgreSQL 16 + Redis 7 + Node API container topology
├── .env.example                 # Standardized environment configuration template
└── README.md                    # Platform documentation and user guide
```
