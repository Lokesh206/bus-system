# Karnataka Smart Transit 2.0 — Architecture & Entity-Relationship Specification

## 1. System Overview & Monorepo Structure

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

---

## 2. Relational Database Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    TERMINAL ||--o{ GATE : houses
    GATE ||--o{ GATE_SCAN_LOG : records
    TERMINAL ||--o{ ROUTE_STOP : locates
    ROUTE ||--o{ ROUTE_STOP : includes
    ROUTE ||--o{ TRIP : defines
    BUS ||--o{ TRIP : assigned_to
    BUS ||--o{ GPS_TELEMETRY : streams
    TRIP ||--o{ SEAT_INVENTORY : manages
    TRIP ||--o{ BOOKING : reserved_on
    TRIP ||--o{ DISRUPTION_EVENT : experiences
    BOOKING ||--o{ PASSENGER : contains
    BOOKING ||--o{ PAYMENT : settles
    PASSENGER ||--o| SEAT_INVENTORY : occupies
    PASSENGER ||--o| TICKET : owns
    TICKET ||--o{ GATE_SCAN_LOG : validates_at
    USER ||--o{ BOOKING : places
    USER ||--o{ GATE_SCAN_LOG : operates

    TERMINAL {
        string id PK
        string code UK
        string name
        string city
        float latitude
        float longitude
    }

    GATE {
        string id PK
        string terminalId FK
        string gateCode
        string platform
        string healthStatus
        string assignedTripId
    }

    ROUTE {
        string id PK
        string code UK
        string name
        string source
        string destination
        float distanceKm
        float highwayTollFee
    }

    BUS {
        string id PK
        string registrationNo UK
        string serviceType
        boolean isAc
        int capacity
    }

    TRIP {
        string id PK
        string routeId FK
        string busId FK
        datetime scheduledDeparture
        string status
    }

    SEAT_INVENTORY {
        string id PK
        string tripId FK
        string seatNumber
        string state
        string heldBy
        datetime holdExpiresAt
        int version
    }

    BOOKING {
        string id PK
        string pnr UK
        string tripId FK
        float totalAmount
        string paymentStatus
        string idempotencyKey UK
    }

    PASSENGER {
        string id PK
        string bookingId FK
        string name
        int age
        string gender
        boolean isKarnatakaResident
        boolean isShaktiApproved
        string assignedSeat
        float fareAmount
    }

    TICKET {
        string id PK
        string ticketNumber UK
        string passengerId FK
        string tripId FK
        string seatNumber
        string tokenSignature
        string keyIdentifier
        string nonce UK
        boolean isBoarded
        datetime boardedAt
    }

    GATE_SCAN_LOG {
        string id PK
        datetime timestamp
        string gateId FK
        string tripId FK
        string ticketId FK
        string decision
        string diagnosticCode
        string details
    }

    GPS_TELEMETRY {
        string id PK
        string busId FK
        datetime timestamp
        float latitude
        float longitude
        float speedKmh
        float headingDegrees
        string nextStopName
        int delayMinutes
    }
```

---

## 3. Concurrency & Security Architecture

1. **Atomic Seat Booking & Double-Booking Prevention**:
   - Each trip operates an in-memory or database-level row mutex (`TRIP_LOCK_{tripId}`).
   - When concurrent requests arrive for the same seat, they are serialized.
   - The first request verifies seat state (`AVAILABLE`), transitions state to `CONFIRMED`, and increments optimistic concurrency `version`.
   - The second request discovers state is no longer `AVAILABLE`, aborts atomically, and returns a clean `409 Conflict` error.

2. **Cryptographic Transit Token Format (`KST2`)**:
   - Structure: `KST2.<keyIdentifier>.<base64UrlPayload>.<hmacSignature>`
   - Payload:
     ```json
     {
       "tid": "KA-KSRTC-2026-15956",
       "pnr": "KA591332",
       "bid": "BUS-KA-01-4821",
       "rid": "route-1",
       "sid": "12W",
       "pid": "PAX-9A82BC10",
       "iat": 1727627400,
       "exp": 1727713800,
       "nonce": "7f8b92a10c9d3e4f"
     }
     ```
   - Verified server-side via constant-time cryptographic equality (`crypto.timingSafeEqual`) to eliminate timing side-channel exploits.

3. **Turnstile Digital Twin States**:
   - `LOCKED_IDLE`: Waiting for scan, barrier flaps centered, sensor beams armed.
   - `VERIFYING`: Optical QR decoded, cryptographic hash evaluated against server keystore.
   - `ACCESS_GRANTED`: Flaps swing open 70° outward, green LED pulse, welcome chime synthesized.
   - `ACCESS_DENIED`: Flaps remain locked shut, red LED strobe, rejection buzzer alarm.
   - `SENSOR_OBSTRUCTION`: Anti-tailgating alarm sounds if passage sensor is held without authorization.
   - `EMERGENCY_EGRESS`: Failsafe override swinging both flaps outward for unrestricted terminal evacuation.
