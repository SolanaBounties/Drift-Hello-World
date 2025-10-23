import { DriftClient } from '@drift-labs/sdk';

// Get all methods from DriftClient prototype
const methods = Object.getOwnPropertyNames(DriftClient.prototype);
const initMethods = methods.filter(m => m.toLowerCase().includes('init'));

console.log('All initialization methods:');
initMethods.forEach(m => console.log('  -', m));

console.log('\nAll DriftClient methods (first 50):');
methods.slice(0, 50).forEach(m => console.log('  -', m));