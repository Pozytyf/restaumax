import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { Building2, ShieldCheck, LogOut, Plus, RefreshCw, Ban, CheckCircle2, Eye, EyeOff, LayoutDashboard, ClipboardList, Users, CreditCard, Wallet, Shield, ChartNoAxesCombined, Settings } from 'lucide-react';

type RestaurantRow = { slug: string; name: string; ownerName?: string; ownerEmail?: string; status?: string; isOpen?: boolean };
type RegistrationRequest = { id: string; uid: string; email: string; ownerName: string; restaurantName: string; city: string; phone: string; createdAt: number };

export const PlatformAdminView: React.FC<{ onBack: () => void; onOpenRestaurant: (slug: string) => void }> = ({ onBack, onOpenRestaurant }) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [registrationRequests, setRegistrationRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [restaurantStatus, setRestaurantStatus] = useState('all');
  const [form, setForm] = useState({ name: '', ownerName: '', ownerEmail: '', ownerPassword: '' });

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const request = useCallback(async (body?: Record<string, unknown>, action?: string) => {
    if (!auth.currentUser) throw new Error('Session non authentifiée.');
    const token = await auth.currentUser.getIdToken(true);
    const response = await fetch(action ? `/api/platform-admin?action=${encodeURIComponent(action)}` : '/api/platform-admin', {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Opération refusée.');
    // The first allowlisted request may have just received the super-admin custom claim.
    await auth.currentUser?.getIdToken(true);
    return data;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [data, pending] = await Promise.all([request(), request(undefined, 'registration_requests')]);
      setRestaurants(data.restaurants || []);
      setRegistrationRequests(pending.requests || []);
    } catch (e: any) { setError(e.message || 'Accès super-administrateur refusé.'); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { if (user) refresh(); else setRestaurants([]); }, [user, refresh]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true);
    try { await signInWithEmailAndPassword(auth, email.trim(), password); setPassword(''); }
    catch { setError('Identifiants invalides ou compte désactivé.'); }
    finally { setLoading(false); }
  };

  const createRestaurant = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); setLoading(true);
    try {
      const result = await request({ action: 'create_restaurant', ...form });
      setNotice(`Restaurant créé. Compte propriétaire : ${result.owner.email}`);
      setForm({ name: '', ownerName: '', ownerEmail: '', ownerPassword: '' });
      setShowCreate(false); await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const reviewRegistration = async (item: RegistrationRequest, decision: 'approve_registration' | 'reject_registration') => {
    const verb = decision === 'approve_registration' ? 'approuver' : 'refuser';
    if (!window.confirm(`Confirmer : ${verb} la demande de ${item.restaurantName} ?`)) return;
    setLoading(true); setError(''); setNotice('');
    try {
      const result = await request({ action: decision, uid: item.uid });
      setNotice(decision === 'approve_registration'
        ? `Demande approuvée. Le restaurant ${result.restaurant?.name || item.restaurantName} est activé et son propriétaire peut maintenant se connecter.`
        : 'Demande refusée. Aucun accès de gestion n’a été accordé.');
      await refresh();
    } catch (e: any) { setError(e.message || 'Impossible de traiter cette demande.'); }
    finally { setLoading(false); }
  };

  const activateExistingOwner = async (restaurant: RestaurantRow) => {
    if (!restaurant.ownerEmail || restaurant.ownerEmail.toLowerCase() !== "essaidebali@gmail.com") return;
    if (!window.confirm(`Vérifier et restaurer l'accès propriétaire de ${restaurant.ownerEmail} pour ${restaurant.name} ?`)) return;
    setLoading(true); setError(''); setNotice('');
    try {
      const result = await request({ action: 'activate_existing_owner', email: restaurant.ownerEmail, slug: restaurant.slug });
      setNotice(`Accès propriétaire vérifié et activé pour ${result.owner.email} — ${result.restaurant.name}. Le propriétaire devra se reconnecter.`);
      await refresh();
    } catch (e: any) { setError(e.message || 'Activation propriétaire refusée.'); }
    finally { setLoading(false); }
  };

  const setStatus = async (restaurant: RestaurantRow, status: 'active' | 'suspended') => {
    setLoading(true); setError('');
    try { await request({ action: 'set_restaurant_status', slug: restaurant.slug, status }); await refresh(); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return <div className="min-h-screen bg-slate-950 text-slate-100">
    <header className="border-b border-slate-800 bg-slate-900 px-5 py-4">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-orange-500 p-2"><ShieldCheck size={22}/></div><div><h1 className="text-2xl md:text-4xl font-black">RestauMax · Administration centrale</h1><p className="text-sm md:text-base text-slate-300">Supervision de la plateforme multi-restaurants</p></div></div>
        <div className="flex gap-2"><button onClick={onBack} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">Accueil</button>{user && <button onClick={() => signOut(auth)} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm"><LogOut size={15}/> Déconnexion</button>}</div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl space-y-6 p-5 md:p-8">
      {error && <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-200">{notice}</div>}
      {user && <section className="rounded-2xl bg-[#172b40] p-5 md:p-7 shadow-lg">
        <div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl md:text-2xl font-extrabold text-white">Administration centrale</h2><span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-300">Superadmin</span></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            {label:'Vue globale',icon:LayoutDashboard,target:'admin-overview',active:true},
            {label:'Restaurants',icon:Building2,target:'admin-restaurants',active:true},
            {label:'Inscriptions',icon:ClipboardList,target:'admin-registrations',active:true},
            {label:'Utilisateurs',icon:Users,active:false},
            {label:'Abonnements',icon:CreditCard,active:false},
            {label:'Paiements',icon:Wallet,active:false},
            {label:'Sécurité',icon:Shield,active:false},
            {label:'Rapports',icon:ChartNoAxesCombined,active:false},
            {label:'Paramètres',icon:Settings,active:false}
          ].map(tile=>{const Icon=tile.icon;return <button key={tile.label} type="button" disabled={!tile.active} onClick={()=>tile.target&&document.getElementById(tile.target)?.scrollIntoView({behavior:'smooth',block:'start'})} className={`flex min-h-[104px] md:min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-center transition-colors ${tile.active?'border-white/5 bg-[#263e56] text-white hover:bg-[#34516e]':'cursor-not-allowed border-white/5 bg-[#20364c]/60 text-slate-500'}`}><Icon size={26}/><span className="text-sm md:text-base font-bold">{tile.label}</span>{!tile.active&&<span className="text-[11px] uppercase tracking-wide">À activer</span>}</button>})}
        </div>
      </section>}
      {!user ? <form onSubmit={login} className="mx-auto mt-16 max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-7">
        <h2 className="text-xl font-bold">Connexion super-administrateur</h2><p className="text-sm text-slate-400">Accès réservé aux comptes explicitement autorisés par la configuration sécurisée RestauMax.</p>
        <label className="block text-sm">Adresse e-mail<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"/></label>
        <label className="block text-sm">Mot de passe<div className="relative mt-1"><input required type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 pr-12"/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
        <button disabled={loading} className="w-full rounded-lg bg-orange-500 p-3 font-bold text-white disabled:opacity-50">{loading ? 'Connexion…' : 'Se connecter'}</button>
      </form> : <><section id="admin-overview" className="scroll-mt-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6"><p className="text-base text-slate-300">Restaurants enregistrés</p><p className="mt-2 text-3xl font-black">{restaurants.length}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6"><p className="text-base text-slate-300">Établissements actifs</p><p className="mt-2 text-3xl font-black">{restaurants.filter(r=>r.status !== 'suspended').length}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6"><p className="text-base text-slate-300">Compte connecté</p><p className="mt-2 truncate text-sm font-bold">{user.email}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6"><p className="text-base text-slate-300">Demandes à examiner</p><p className="mt-2 text-3xl font-black">{registrationRequests.length}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6"><p className="text-base text-slate-300">Restaurants suspendus</p><p className="mt-2 text-3xl font-black">{restaurants.filter(r=>r.status === 'suspended').length}</p></div>
      </section>
      <div id="admin-restaurants" className="scroll-mt-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">Gestion des restaurants</h2><p className="text-sm text-slate-400">Création, attribution du propriétaire et activation des établissements.</p></div><div className="flex gap-2"><button onClick={refresh} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm"><RefreshCw size={15}/> Actualiser</button><button onClick={()=>setShowCreate(v=>!v)} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold"><Plus size={16}/> Nouveau restaurant</button></div></div>
      {showCreate && <form onSubmit={createRestaurant} className="grid gap-3 rounded-2xl border border-slate-700 bg-slate-900 p-5 md:grid-cols-2">
        <h3 className="md:col-span-2 text-lg font-bold">Enregistrer un restaurant et son propriétaire</h3>
        <input required placeholder="Nom du restaurant" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        <input required placeholder="Nom complet du propriétaire" value={form.ownerName} onChange={e=>setForm({...form,ownerName:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        <input required type="email" placeholder="E-mail du propriétaire" value={form.ownerEmail} onChange={e=>setForm({...form,ownerEmail:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        <div className="relative"><input required minLength={10} type={showOwnerPassword ? "text" : "password"} autoComplete="new-password" placeholder="Mot de passe initial (10 caractères min.)" value={form.ownerPassword} onChange={e=>setForm({...form,ownerPassword:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 pr-12"/><button type="button" onClick={()=>setShowOwnerPassword(v=>!v)} aria-label={showOwnerPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showOwnerPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
        <p className="text-xs text-amber-300 md:col-span-2">Transmets le mot de passe initial au propriétaire par un canal privé. Il devra le modifier dès sa première connexion.</p>
        <div className="flex gap-2 md:col-span-2"><button disabled={loading} className="rounded-lg bg-orange-500 px-5 py-2 font-bold">Créer le restaurant</button><button type="button" onClick={()=>setShowCreate(false)} className="rounded-lg border border-slate-700 px-4 py-2">Annuler</button></div>
      </form>}
      <section id="admin-registrations" className="scroll-mt-5 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 p-4"><div><h2 className="font-bold">Demandes d’inscription</h2><p className="text-xs text-slate-400">Chaque demande doit être examinée avant l’attribution des droits propriétaire.</p></div><span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300">{registrationRequests.length} en attente</span></div>
        {registrationRequests.length === 0 ? <p className="p-6 text-center text-sm text-slate-400">Aucune demande en attente.</p> : registrationRequests.map(item=><div key={item.uid} className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 p-4 last:border-0">
          <div className="min-w-0"><p className="font-bold">{item.restaurantName}</p><p className="text-sm text-slate-300">{item.ownerName} · {item.email}</p><p className="text-xs text-slate-500">{item.city} · {item.phone} · {new Date(item.createdAt).toLocaleDateString('fr-FR')}</p></div>
          <div className="flex gap-2"><button disabled={loading} onClick={()=>reviewRegistration(item,'reject_registration')} className="rounded-lg border border-rose-800 px-3 py-2 text-xs font-bold text-rose-300 disabled:opacity-50">Refuser</button><button disabled={loading} onClick={()=>reviewRegistration(item,'approve_registration')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Approuver</button></div>
        </div>)}
      </section>
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"><div className="grid gap-3 border-b border-slate-800 p-4 md:grid-cols-[1fr_220px]"><div><h3 className="font-bold">Établissements ({restaurants.length})</h3><p className="text-xs text-slate-400">Recherche et filtrage du parc de restaurants.</p><input value={restaurantSearch} onChange={e=>setRestaurantSearch(e.target.value)} placeholder="Rechercher restaurant, propriétaire, e-mail ou ville…" className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-sm"/></div><select value={restaurantStatus} onChange={e=>setRestaurantStatus(e.target.value)} className="self-end rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-sm"><option value="all">Tous les statuts</option><option value="active">Actifs</option><option value="suspended">Suspendus</option></select></div>{restaurants.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">Aucun restaurant enregistré.</p> : restaurants.filter(r=>{const q=restaurantSearch.trim().toLowerCase();const matches=!q||[r.name,r.slug,r.ownerName,r.ownerEmail,(r as any).city].some(v=>String(v||"").toLowerCase().includes(q));return matches&&(restaurantStatus==="all"||(restaurantStatus==="suspended"?r.status==="suspended":r.status!=="suspended"));}).map(r=><div key={r.slug} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4 last:border-0"><div className="flex items-center gap-3"><div className="rounded-xl bg-slate-800 p-3"><Building2 size={20}/></div><div><p className="font-bold">{r.name}</p><p className="text-xs text-slate-400">{r.slug} · {r.ownerName || r.ownerEmail || 'Propriétaire non renseigné'}</p></div></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${r.status === 'suspended' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>{r.status === 'suspended' ? 'Suspendu' : 'Actif'}</span><button onClick={()=>onOpenRestaurant(r.slug)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold">Gérer</button>{r.ownerEmail?.toLowerCase() === "essaidebali@gmail.com" && <button disabled={loading} onClick={()=>activateExistingOwner(r)} className="rounded-lg border border-orange-700 bg-orange-950/40 px-3 py-2 text-xs font-bold text-orange-200 disabled:opacity-50">Activer propriétaire</button>}<button onClick={()=>setStatus(r,r.status === 'suspended' ? 'active' : 'suspended')} className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-xs">{r.status === 'suspended' ? <CheckCircle2 size={14}/> : <Ban size={14}/>} {r.status === 'suspended' ? 'Réactiver' : 'Suspendre'}</button></div></div>)}</div>
      </>}
    </main>
  </div>;
};
