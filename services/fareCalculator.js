/**
 * Karnataka State Road Transport Fare Calculation Engine
 * Implements KSRTC / BMTC rate formulas, toll surcharges, passenger cess, AC GST, and Shakti Scheme.
 */

const FARE_RATES = {
  'Karnataka Sarige': {
    ratePerKm: 1.22,
    minFare: 15,
    passengerCess: 5,
    gstPercent: 0,
    shaktiEligible: true,
    description: 'Non-AC Ordinary Express Service'
  },
  'Rajahamsa': {
    ratePerKm: 1.78,
    minFare: 40,
    passengerCess: 10,
    gstPercent: 0,
    shaktiEligible: false,
    description: 'Deluxe 2+2 Semi-Sleeper Service'
  },
  'Airavat Club Class': {
    ratePerKm: 2.35,
    minFare: 75,
    passengerCess: 15,
    gstPercent: 5,
    shaktiEligible: false,
    description: 'Premium Volvo Multi-Axle AC Service'
  },
  'EV Power Plus': {
    ratePerKm: 2.10,
    minFare: 60,
    passengerCess: 10,
    gstPercent: 5,
    shaktiEligible: false,
    description: 'Intercity Electric AC Express'
  }
};

/**
 * Calculates itemized fare for a journey.
 * 
 * @param {Object} params
 * @param {string} params.serviceType - Bus service classification
 * @param {number} params.distanceKm - Distance in kilometers
 * @param {number} params.tollFee - Route toll fee
 * @param {Array<Object>} params.passengers - List of passengers { name, age, gender, isKarnatakaResident, isShaktiScheme }
 * @returns {Object} Full breakdown of fare
 */
function calculateFare({ serviceType, distanceKm, tollFee = 0, passengers = [] }) {
  const serviceConfig = FARE_RATES[serviceType] || FARE_RATES['Karnataka Sarige'];
  
  if (!passengers || passengers.length === 0) {
    passengers = [{ name: 'Passenger 1', age: 30, gender: 'Male', isKarnatakaResident: false, isShaktiScheme: false }];
  }

  let totalBaseFare = 0;
  let totalCess = 0;
  let totalToll = 0;
  let totalGst = 0;
  let totalDiscount = 0;
  let totalPayable = 0;
  const passengerBreakdowns = [];

  const rawBaseFare = Math.max(serviceConfig.minFare, Math.round(distanceKm * serviceConfig.ratePerKm));
  const perPaxToll = Math.round(tollFee / Math.max(1, passengers.length));

  for (const pax of passengers) {
    let paxBase = rawBaseFare;
    let paxCess = serviceConfig.passengerCess;
    let paxToll = perPaxToll;
    let discount = 0;
    let discountReason = 'None';
    let isShaktiApproved = false;

    // Check Karnataka Shakti Scheme eligibility (Female, Karnataka resident, on eligible non-AC service)
    if (
      serviceConfig.shaktiEligible &&
      pax.gender === 'Female' &&
      (pax.isKarnatakaResident === true || pax.isShaktiScheme === true)
    ) {
      discount = paxBase + paxCess + paxToll; // 100% Free Travel under Karnataka Shakti Scheme
      paxBase = 0;
      paxCess = 0;
      paxToll = 0;
      discountReason = 'Karnataka Shakti Scheme (Free Travel for Women)';
      isShaktiApproved = true;
    } else if (pax.age >= 60) {
      // Senior citizen 25% discount on base fare
      discount = Math.round(paxBase * 0.25);
      paxBase -= discount;
      discountReason = 'Senior Citizen Concession (25%)';
    } else if (pax.age < 12) {
      // Child 50% discount on base fare
      discount = Math.round(paxBase * 0.50);
      paxBase -= discount;
      discountReason = 'Child Fare (50%)';
    }

    // AC GST calculation
    const taxableAmount = paxBase + paxCess + paxToll;
    const paxGst = serviceConfig.gstPercent > 0 ? Math.round(taxableAmount * (serviceConfig.gstPercent / 100)) : 0;
    const paxFinalFare = taxableAmount + paxGst;

    passengerBreakdowns.push({
      passengerName: pax.name,
      age: pax.age,
      gender: pax.gender,
      isShaktiApproved,
      rawBaseFare,
      discount,
      discountReason,
      netBaseFare: paxBase,
      passengerCess: paxCess,
      tollCharge: paxToll,
      gst: paxGst,
      finalFare: paxFinalFare
    });

    totalBaseFare += paxBase;
    totalCess += paxCess;
    totalToll += paxToll;
    totalGst += paxGst;
    totalDiscount += discount;
    totalPayable += paxFinalFare;
  }

  return {
    serviceType,
    serviceDescription: serviceConfig.description,
    distanceKm,
    ratePerKm: serviceConfig.ratePerKm,
    gstPercent: serviceConfig.gstPercent,
    passengerCount: passengers.length,
    passengerBreakdowns,
    totals: {
      baseFare: totalBaseFare,
      amenityCess: totalCess,
      tollCharges: totalToll,
      gst: totalGst,
      totalDiscount,
      totalPayable: Math.max(0, totalPayable)
    }
  };
}

module.exports = {
  FARE_RATES,
  calculateFare
};

