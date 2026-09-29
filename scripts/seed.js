/**
 * Karnataka Smart Transit 2.0 Database Seeding Script
 */

const { transitRepository } = require('../apps/api/src/db/transitDb');

function seedDatabase() {
  console.log('Seeding Karnataka Smart Transit 2.0 database with sample routes, terminals, buses, and trips...');
  const result = transitRepository.resetDemo();
  console.log('✅ Seed completed successfully:', result.message);
  console.log('Active Terminals:', transitRepository.data.terminals.length);
  console.log('Active Gates:', transitRepository.data.gates.length);
  console.log('Active Routes:', transitRepository.data.routes.length);
  console.log('Active Buses:', transitRepository.data.buses.length);
}

seedDatabase();
