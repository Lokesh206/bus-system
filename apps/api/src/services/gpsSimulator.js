/**
 * Karnataka Transit GPS Fleet Tracking & Repeatable Highway Trajectory Simulator
 */

const ROUTE_WAYPOINTS = {
  'route-1': [ // Bengaluru to Mysuru Expressway
    { name: 'Bengaluru Majestic (Departure)', lat: 12.9778, lng: 77.5713, km: 0 },
    { name: 'Kengeri Satellite BS', lat: 12.9090, lng: 77.4830, km: 16 },
    { name: 'Bidadi Industrial Bypass', lat: 12.7981, lng: 77.3824, km: 34 },
    { name: 'Ramanagara Silk City', lat: 12.7150, lng: 77.2813, km: 50 },
    { name: 'Channapatna Craft Town', lat: 12.6518, lng: 77.2046, km: 62 },
    { name: 'Maddur Station Point', lat: 12.5844, lng: 77.0450, km: 82 },
    { name: 'Mandya Sugar Bowl', lat: 12.5244, lng: 76.8958, km: 101 },
    { name: 'Srirangapatna Heritage Gateway', lat: 12.4220, lng: 76.6934, km: 128 },
    { name: 'Mysuru Suburban Bus Stand', lat: 12.3118, lng: 76.6575, km: 145 }
  ],
  'route-2': [ // Bengaluru to Mangaluru via Shiradi Ghat
    { name: 'Bengaluru Majestic', lat: 12.9778, lng: 77.5713, km: 0 },
    { name: 'Nelamangala Tollgate', lat: 13.0970, lng: 77.3930, km: 28 },
    { name: 'Kunigal Cross', lat: 13.0230, lng: 77.0270, km: 74 },
    { name: 'Channarayapatna Bypass', lat: 12.9030, lng: 76.3900, km: 148 },
    { name: 'Hassan KSRTC Station', lat: 13.0033, lng: 76.1004, km: 185 },
    { name: 'Sakleshpur Coffee Valley', lat: 12.9430, lng: 75.7870, km: 225 },
    { name: 'Uppinangady River Junction', lat: 12.8360, lng: 75.2570, km: 298 },
    { name: 'Mangaluru KSRTC Terminal', lat: 12.8710, lng: 74.8430, km: 350 }
  ]
};

function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const toDeg = rad => (rad * 180) / Math.PI;

  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const brng = toDeg(Math.atan2(y, x));
  return Math.round((brng + 360) % 360);
}

class GpsFleetSimulator {
  constructor(io = null) {
    this.io = io;
    this.activeSimulations = new Map();
    this.telemetryHistory = new Map();
    this.intervalHandle = null;
    this.initDefaultSimulations();
  }

  initDefaultSimulations() {
    this.registerBusSimulation('BUS-KA-01-4821', 'route-1', 0.22);
    this.registerBusSimulation('BUS-KA-09-7712', 'route-1', 0.65);
    this.registerBusSimulation('BUS-KA-19-3305', 'route-2', 0.40);
  }

  setSocketIO(io) {
    this.io = io;
  }

  start() {
    if (this.intervalHandle) return;
    if (this.activeSimulations.size === 0) {
      this.initDefaultSimulations();
    }

    this.intervalHandle = setInterval(() => {
      this.tick();
    }, 2500);

    console.log('GPS Fleet Simulator started with repeatable highway trajectories.');
  }

  registerBusSimulation(busId, routeId, initialProgress = 0) {
    const waypoints = ROUTE_WAYPOINTS[routeId] || ROUTE_WAYPOINTS['route-1'];
    this.activeSimulations.set(busId, {
      busId,
      routeId,
      progress: initialProgress, // 0.0 to 1.0
      speedKmh: Math.floor(62 + Math.random() * 18),
      waypoints,
      delayMinutes: Math.floor(Math.random() * 4)
    });
    this.telemetryHistory.set(busId, []);
  }

  tick() {
    this.activeSimulations.forEach((sim, busId) => {
      // Advance position smoothly along route
      sim.progress += 0.0035;
      if (sim.progress > 1.0) {
        sim.progress = 0.02; // Loop back for continuous simulation
      }

      // Vary speed realistically
      sim.speedKmh = Math.max(35, Math.min(85, Math.round(sim.speedKmh + (Math.random() * 6 - 3))));

      const totalSegments = sim.waypoints.length - 1;
      const exactIndex = sim.progress * totalSegments;
      const segIndex = Math.min(totalSegments - 1, Math.floor(exactIndex));
      const segProgress = exactIndex - segIndex;

      const p1 = sim.waypoints[segIndex];
      const p2 = sim.waypoints[segIndex + 1] || p1;

      // Interpolate coordinates
      const currentLat = p1.lat + (p2.lat - p1.lat) * segProgress;
      const currentLng = p1.lng + (p2.lng - p1.lng) * segProgress;
      const heading = calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);

      const nextStop = p2.name;
      const remainingDistanceKm = Math.max(0, Math.round((1 - sim.progress) * p2.km));
      const etaMinutes = Math.max(1, Math.round((remainingDistanceKm / (sim.speedKmh || 60)) * 60) + sim.delayMinutes);

      const telemetry = {
        busId,
        routeId: sim.routeId,
        latitude: parseFloat(currentLat.toFixed(5)),
        longitude: parseFloat(currentLng.toFixed(5)),
        speedKmh: sim.speedKmh,
        headingDegrees: heading,
        nextStopName: nextStop,
        remainingDistanceKm,
        etaMinutes,
        delayMinutes: sim.delayMinutes,
        isSimulated: true,
        timestamp: new Date().toISOString()
      };

      // Store in memory breadcrumbs
      const hist = this.telemetryHistory.get(busId) || [];
      hist.push({ lat: telemetry.latitude, lng: telemetry.longitude, t: telemetry.timestamp });
      if (hist.length > 50) hist.shift();
      this.telemetryHistory.set(busId, hist);

      // Broadcast over WebSockets
      if (this.io) {
        this.io.emit('fleet:telemetry', telemetry);
      }
    });
  }

  getLiveTelemetry() {
    const result = [];
    this.activeSimulations.forEach((sim, busId) => {
      const hist = this.telemetryHistory.get(busId) || [];
      const latest = hist[hist.length - 1];
      if (latest) {
        result.push({
          busId,
          routeId: sim.routeId,
          latitude: latest.lat,
          longitude: latest.lng,
          speedKmh: sim.speedKmh,
          nextStop: sim.waypoints[Math.min(sim.waypoints.length - 1, Math.floor(sim.progress * (sim.waypoints.length - 1)) + 1)]?.name,
          delayMinutes: sim.delayMinutes,
          isSimulated: true,
          timestamp: latest.t
        });
      }
    });
    return result;
  }

  getRoutePolylines() {
    return ROUTE_WAYPOINTS;
  }
}

const gpsSimulator = new GpsFleetSimulator();

module.exports = {
  GpsFleetSimulator,
  gpsSimulator,
  ROUTE_WAYPOINTS
};
