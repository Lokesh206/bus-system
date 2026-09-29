const fs = require('fs');
const path = require('path');

const DEFAULT_TARIFF_PATH = path.join(__dirname, '../../config/tariffs.v1.json');

class TariffEngine {
  constructor(tariffFilePath = DEFAULT_TARIFF_PATH) {
    this.tariffFilePath = tariffFilePath;
    this.reload();
  }

  reload() {
    try {
      const content = fs.readFileSync(this.tariffFilePath, 'utf8');
      this.config = JSON.parse(content);
    } catch (err) {
      console.warn('Could not load tariff config from file, using fallback:', err.message);
      this.config = {
        version: "fallback-2026",
        disclaimer: "Demonstration tariff fallback schedule.",
        serviceClasses: {
          'Karnataka Sarige': { ratePerKm: 1.22, minFare: 15, passengerCess: 5, gstPercent: 0, shaktiEligible: true },
          'Rajahamsa': { ratePerKm: 1.78, minFare: 40, passengerCess: 10, gstPercent: 0, shaktiEligible: false },
          'Airavat Club Class': { ratePerKm: 2.35, minFare: 75, passengerCess: 15, gstPercent: 5, shaktiEligible: false },
          'EV Power Plus': { ratePerKm: 2.10, minFare: 60, passengerCess: 10, gstPercent: 5, shaktiEligible: false }
        },
        concessions: {
          shaktiScheme: { eligibleGenders: ["Female"], requiresKarnatakaDomicile: true, allowedServiceClasses: ["Karnataka Sarige"] },
          seniorCitizen: { minAge: 60, discountPercent: 25 },
          child: { maxAge: 11, discountPercent: 50 }
        }
      };
    }
  }

  getTariffSchedule() {
    return this.config;
  }

  calculate({ serviceType, distanceKm, tollFee = 0, passengers = [] }) {
    const service = this.config.serviceClasses[serviceType] || this.config.serviceClasses['Karnataka Sarige'];
    
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

    const rawBaseFare = Math.max(service.minFare, Math.round(distanceKm * service.ratePerKm));
    const perPaxToll = Math.round(tollFee / Math.max(1, passengers.length));

    for (const pax of passengers) {
      let paxBase = rawBaseFare;
      let paxCess = service.passengerCess;
      let paxToll = perPaxToll;
      let discount = 0;
      let discountReason = 'None';
      let isShaktiApproved = false;

      // Shakti Scheme Check (Female, Karnataka resident, non-AC eligible class)
      const shaktiRule = this.config.concessions?.shaktiScheme;
      const isEligibleService = shaktiRule?.allowedServiceClasses ? shaktiRule.allowedServiceClasses.includes(serviceType) : service.shaktiEligible;
      
      if (
        isEligibleService &&
        pax.gender === 'Female' &&
        (pax.isKarnatakaResident === true || pax.isShaktiScheme === true)
      ) {
        discount = paxBase + paxCess + paxToll; // Full waiver
        paxBase = 0;
        paxCess = 0;
        paxToll = 0;
        discountReason = 'Karnataka Shakti Scheme (Free Travel for Women Residents)';
        isShaktiApproved = true;
      } else if (pax.age >= (this.config.concessions?.seniorCitizen?.minAge || 60)) {
        const pct = (this.config.concessions?.seniorCitizen?.discountPercent || 25) / 100;
        discount = Math.round(paxBase * pct);
        paxBase -= discount;
        discountReason = `Senior Citizen Concession (${Math.round(pct * 100)}%)`;
      } else if (pax.age <= (this.config.concessions?.child?.maxAge || 11)) {
        const pct = (this.config.concessions?.child?.discountPercent || 50) / 100;
        discount = Math.round(paxBase * pct);
        paxBase -= discount;
        discountReason = `Child Concession (${Math.round(pct * 100)}%)`;
      }

      // Applicable Tax (GST on AC services)
      const taxableAmount = paxBase + paxCess + paxToll;
      const paxGst = service.gstPercent > 0 ? Math.round(taxableAmount * (service.gstPercent / 100)) : 0;
      const paxFinal = taxableAmount + paxGst;

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
        finalFare: paxFinal
      });

      totalBaseFare += paxBase;
      totalCess += paxCess;
      totalToll += paxToll;
      totalGst += paxGst;
      totalDiscount += discount;
      totalPayable += paxFinal;
    }

    return {
      version: this.config.version,
      disclaimer: this.config.disclaimer,
      serviceType,
      distanceKm,
      ratePerKm: service.ratePerKm,
      gstPercent: service.gstPercent,
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
}

const defaultTariffEngine = new TariffEngine();

module.exports = {
  TariffEngine,
  defaultTariffEngine
};
