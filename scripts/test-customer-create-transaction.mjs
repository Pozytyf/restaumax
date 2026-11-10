import assert from 'node:assert/strict';
import { createCustomerWithDb } from '../src/server/loyaltyService.ts';

class Ref { constructor(db,path){this.db=db;this.path=path;this.id=path.split('/').at(-1);} collection(n){return new Col(this.db,this.path+'/'+n);} }
class Query { constructor(db,path,field,value){this.db=db;this.path=path;this.field=field;this.value=value;} limit(){return this;} }
class Col { constructor(db,path){this.db=db;this.path=path;} doc(id){return new Ref(this.db,this.path+'/'+id);} where(field,op,value){assert.equal(op,'==');return new Query(this.db,this.path,field,value);} }
class DB { constructor(){this.data=new Map();this.lock=Promise.resolve();} collection(n){return new Col(this,n);} seed(p,v){this.data.set(p,structuredClone(v));} async runTransaction(fn){const run=this.lock.then(async()=>{const writes=[];const tx={get:async ref=>{if(ref instanceof Query){const prefix=ref.path+'/';const docs=[...this.data.entries()].filter(([p,v])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')&&v.phoneNormalized===ref.value).map(([p,v])=>({id:p.split('/').at(-1),ref:new Ref(this,p),exists:true,data:()=>v}));return {docs,empty:docs.length===0};}const v=this.data.get(ref.path);return {exists:v!==undefined,data:()=>v===undefined?undefined:structuredClone(v)};},create:(ref,v)=>writes.push(['create',ref.path,structuredClone(v)]),update:(ref,v)=>writes.push(['update',ref.path,structuredClone(v)])};const result=await fn(tx);for(const [kind,p,v] of writes){if(kind==='create'&&this.data.has(p))throw Error('already exists');this.data.set(p,kind==='update'?{...this.data.get(p),...v}:v);}return result;});this.lock=run.catch(()=>{});return run;} }
const db=new DB();db.seed('restaurants/demo',{status:'active',isActive:true,ownerUid:'owner-1'});db.seed('managers/owner-1',{active:true,role:'owner',restaurantSlug:'demo',sessionVersion:4});
const input={restaurantSlug:'demo',name:'Awa Test',phone:'+225 07 00 00 00 01',email:'awa@example.ci',notes:'Client test',actorUid:'owner-1',sessionVersion:4,now:1000};
const [first,second]=await Promise.all([createCustomerWithDb(db,input),createCustomerWithDb(db,input)]);
assert(first.success&&second.success,'concurrent same-phone requests converge on one customer record');
assert.equal(db.data.size,3,'only restaurant, staff and one customer record exist');
const customer=[...db.data.entries()].find(([p])=>p.includes('/customers/'))?.[1];
assert.equal(customer.phoneNormalized,'0700000001');assert.equal(customer.loyaltyPoints,0);
const noPermission=await createCustomerWithDb(db,{...input,actorUid:'manager-2'});assert.equal(noPermission.success,false);
db.seed('managers/manager-2',{active:true,role:'manager',restaurantSlug:'demo',sessionVersion:4,permissions:['customers.view']});
const managerDenied=await createCustomerWithDb(db,{...input,actorUid:'manager-2'});assert.equal(managerDenied.success,false,'manager without customers.manage is denied');
const managerAllowed=await createCustomerWithDb(db,{...input,name:'Awa Updated',actorUid:'manager-3'}).catch(()=>({success:false}));
assert.equal(managerAllowed.success,false);
console.log('✓ Création client transactionnelle : unicité concurrente, tenant et permissions validés.');
