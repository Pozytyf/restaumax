import assert from 'node:assert/strict';
import { filterKitchenTicketItems, getKitchenCourseFromCategory, getKitchenStationFromCategory, mapRestauOrderToKitchenTicket } from '../src/utils/kitchenTicket.ts';
import fs from 'node:fs';
assert.equal(getKitchenStationFromCategory('grillades'), 'grillades');
assert.equal(getKitchenStationFromCategory('boissons'), 'bar');
assert.equal(getKitchenStationFromCategory('plats'), 'plats');
assert.equal(getKitchenStationFromCategory(undefined), 'plats');
assert.equal(getKitchenCourseFromCategory('entrees'), 'entree');
assert.equal(getKitchenCourseFromCategory('desserts'), 'dessert');
assert.equal(getKitchenCourseFromCategory('boissons'), 'boisson');
const items = [
 {id:'g',name:'Poulet',quantity:1,course:'plat',station:'grillades',completed:false},
 {id:'p',name:'Riz',quantity:1,course:'plat',station:'plats',completed:false},
 {id:'b',name:'Jus',quantity:1,course:'boisson',station:'bar',completed:false},
 {id:'legacy',name:'Ancien',quantity:1,course:'plat',completed:false}
];
assert.deepEqual(filterKitchenTicketItems(items,'grillades').map(x=>x.id),['g']);
assert.deepEqual(filterKitchenTicketItems(items,'plats').map(x=>x.id),['p','legacy']);
assert.deepEqual(filterKitchenTicketItems(items,'bar').map(x=>x.id),['b']);
assert.equal(filterKitchenTicketItems(items,'all').length,4);
const mapped=mapRestauOrderToKitchenTicket({id:'o',orderNumber:'CMD-1',restaurantSlug:'demo',orderMode:'sur_place',tableNumber:'4',items:[
{id:'1',menuItemId:'g',name:'Poulet',category:'grillades',basePrice:1000,unitPrice:1000,quantity:1,totalPrice:1000},
{id:'2',menuItemId:'b',name:'Jus',category:'boissons',basePrice:500,unitPrice:500,quantity:1,totalPrice:500}
],itemsCount:2,totalAmount:1500,currency:'FCFA',status:'pending',createdAt:Date.now(),createdAtIso:new Date().toISOString()});
assert.equal(mapped.items[0].station,'grillades');
assert.equal(mapped.items[1].station,'bar');
const kds=fs.readFileSync(new URL('../src/components/kds/KdsView.tsx',import.meta.url),'utf8');
assert(kds.includes("{ id: 'bar', label: 'Bar' }"));
assert(kds.includes("filterKitchenTicketItems(ticket.items, stationMode === 'bar' ? 'bar' : filterStation)"));
assert(kds.includes("t.status === 'pending' || t.status === 'in_prep' || t.status === 'ready'"));
assert(kds.includes("onUpdateTicketStatus(ticket.id, 'cancelled', reason.trim())"));
assert(kds.includes("stationMode === 'bar' ? 'Écran Bar en Direct' : 'Écran KDS Cuisine en Direct'"));
assert(kds.includes('Vider le ticket'));
assert(kds.includes('canCancelActiveTicket &&'));
assert(kds.includes('Annuler</button>'));
assert(kds.includes('Motif obligatoire pour annuler le ticket'));
assert(kds.includes("stationMode === 'bar' ? [{ id: 'bar', label: 'Bar' }]"));
assert(!kds.includes("e.key === 'Tab'"));
assert(kds.includes("target?.closest('input, textarea, select, button, a, [role=\"button\"], [contenteditable=\"true\"]')"));
assert(kds.includes('ticket.items.every(item => item.completed)'));
assert(kds.includes('ticket.stationItems.every(item => item.completed)'));
assert(kds.includes("stationMode === 'bar' ? (item.station || 'plats') === 'bar' : (item.station || 'plats') !== 'bar'"));
assert(kds.includes('ticket.stationItems.every(item => item.completed)'));
assert(kds.includes("stationMode === 'bar' ? (item.station || 'plats') === 'bar' : (item.station || 'plats') !== 'bar'"));
console.log('✓ KDS : routage par station, ticket mixte et navigation clavier validés.');
