import assert from 'node:assert/strict';
import fs from 'node:fs';

const hub = fs.readFileSync(new URL('../src/components/restaumax/RestaurantHubView.tsx', import.meta.url), 'utf8');
assert(hub.includes("actionLabel: 'Gérer les options, suppléments et prix'"), 'module 3 is clearly labelled as catalogue management');
assert(hub.includes("id: 'options-prices'") && hub.includes("setActiveTab('menu_catalog')"), 'module 3 opens the administrative catalogue instead of the public client menu');
assert(hub.includes('Carte bancaire non activée en V1'), 'the cash register module does not advertise an unavailable card payment method');
console.log('Restaurant management navigation checks passed.');
