import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { Building2, ShieldCheck, LogOut, Plus, RefreshCw, Ban, CheckCircle2 } from 'lucide-react';

type RestaurantRow = { slug: string; name: string; ownerName?: string; ownerEmail?: string; status?: string; isOpen?: boolean };

export const PlatformAdminView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', ownerName: '', ownerEmail: '', ownerPassword: '' });

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const request = useCallback(async (body?: Record<string, unknown>) => {
    if (!auth.currentUser) throw new Error('Session non authentifiée.');
    const token = await auth.currentUser.getIdToken(true);
    const response = await fetch('/api/platform-admin', {
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
    try { const data = await request(); setRestaurants(data.restaurants || []); }
    catch (e: any) { setError(e.message || 'Accès super-administrateur refusé.'); }
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

  const setStatus = async (restaurant: RestaurantRow, status: 'active' | 'suspended') => {
    setLoading(true); setError('');
    try { await request({ action: 'set_restaurant_status', slug: restaurant.slug, status }); await refresh(); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return <div className="min-h-screen bg-slate-950 text-slate-100">
    <header className="border-b border-slate-800 bg-slate-900 px-5 py-4">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-orange-500 p-2"><ShieldCheck size={22}/></div><div><h1 className="text-xl font-black">RestauMax · Administration centrale</h1><p className="text-xs text-slate-400">Supervision de la plateforme multi-restaurants</p></div></div>
        <div className="flex gap-2"><button onClick={onBack} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">Accueil</button>{user && <button onClick={() => signOut(auth)} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm"><LogOut size={15}/> Déconnexion</button>}</div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl space-y-6 p-5 md:p-8">
      {error && <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-200">{notice}</div>}
      {!user ? <form onSubmit={login} className="mx-auto mt-16 max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-7">
        <h2 className="text-xl font-bold">Connexion super-administrateur</h2><p className="text-sm text-slate-400">Accès réservé aux comptes explicitement autorisés par la configuration sécurisée RestauMax.</p>
        <label className="block text-sm">Adresse e-mail<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"/></label>
        <label className="block text-sm">Mot de passe<input required type="password" value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"/></label>
        <button disabled={loading} className="w-full rounded-lg bg-orange-500 p-3 font-bold text-white disabled:opacity-50">{loading ? 'Connexion…' : 'Se connecter'}</button>
      </form> : <><section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-sm text-slate-400">Restaurants enregistrés</p><p className="mt-2 text-3xl font-black">{restaurants.length}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-sm text-slate-400">Établissements actifs</p><p className="mt-2 text-3xl font-black">{restaurants.filter(r=>r.status !== 'suspended').length}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-sm text-slate-400">Compte connecté</p><p className="mt-2 truncate text-sm font-bold">{user.email}</p></div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">Gestion des restaurants</h2><p className="text-sm text-slate-400">Création, attribution du propriétaire et activation des établissements.</p></div><div className="flex gap-2"><button onClick={refresh} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm"><RefreshCw size={15}/> Actualiser</button><button onClick={()=>setShowCreate(v=>!v)} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold"><Plus size={16}/> Nouveau restaurant</button></div></div>
      {showCreate && <form onSubmit={createRestaurant} className="grid gap-3 rounded-2xl border border-slate-700 bg-slate-900 p-5 md:grid-cols-2">
        <h3 className="md:col-span-2 text-lg font-bold">Enregistrer un restaurant et son propriétaire</h3>
        <input required placeholder="Nom du restaurant" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        <input required placeholder="Nom complet du propriétaire" value={form.ownerName} onChange={e=>setForm({...form,ownerName:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        <input required type="email" placeholder="E-mail du propriétaire" value={form.ownerEmail} onChange={e=>setForm({...form,ownerEmail:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        <input required minLength={10} type="password" placeholder="Mot de passe initial (10 caractères min.)" value={form.ownerPassword} onChange={e=>setForm({...form,ownerPassword:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        <p className="text-xs text-amber-300 md:col-span-2">Transmets le mot de passe initial au propriétaire par un canal privé. Il devra le modifier dès sa première connexion.</p>
        <div className="flex gap-2 md:col-span-2"><button disabled={loading} className="rounded-lg bg-orange-500 px-5 py-2 font-bold">Créer le restaurant</button><button type="button" onClick={()=>setShowCreate(false)} className="rounded-lg border border-slate-700 px-4 py-2">Annuler</button></div>
      </form>}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"><div className="border-b border-slate-800 p-4 font-bold">Établissements ({restaurants.length})</div>{restaurants.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">Aucun restaurant enregistré.</p> : restaurants.map(r=><div key={r.slug} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4 last:border-0"><div className="flex items-center gap-3"><div className="rounded-xl bg-slate-800 p-3"><Building2 size={20}/></div><div><p className="font-bold">{r.name}</p><p className="text-xs text-slate-400">{r.slug} · {r.ownerName || r.ownerEmail || 'Propriétaire non renseigné'}</p></div></div><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${r.status === 'suspended' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>{r.status === 'suspended' ? 'Suspendu' : 'Actif'}</span><button onClick={()=>setStatus(r,r.status === 'suspended' ? 'active' : 'suspended')} className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-xs">{r.status === 'suspended' ? <CheckCircle2 size={14}/> : <Ban size={14}/>} {r.status === 'suspended' ? 'Réactiver' : 'Suspendre'}</button></div></div>)}</div>
      </>}
    </main>
  </div>;
};
