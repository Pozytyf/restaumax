import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { Building2, ShieldCheck, LogOut, Plus, RefreshCw, Ban, CheckCircle2, Eye, EyeOff } from 'lucide-react';

type RestaurantRow = { slug: string; name: string; ownerName?: string; ownerEmail?: string; status?: string; isOpen?: boolean };

const getAuthErrorMessage = (error: unknown): string => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';

  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Adresse e-mail ou mot de passe incorrect. Vérifie les identifiants saisis.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/user-not-found': 'Aucun compte ne correspond à cette adresse e-mail.',
    'auth/user-disabled': 'Ce compte Firebase est désactivé. Vérifie son état dans Firebase Authentication.',
    'auth/too-many-requests': 'Trop de tentatives de connexion. Patiente avant de réessayer.',
    'auth/network-request-failed': 'Connexion au service Firebase impossible. Vérifie ta connexion Internet.',
    'auth/operation-not-allowed': 'La connexion par e-mail et mot de passe n’est pas autorisée pour ce projet Firebase.',
    'auth/invalid-api-key': 'La clé API Firebase utilisée par cette version est invalide.',
    'auth/app-not-authorized': 'Cette application n’est pas autorisée à utiliser le projet Firebase configuré.',
    'auth/unauthorized-domain': 'Ce domaine n’est pas autorisé dans les domaines Firebase Authentication.',
    'auth/invalid-email': 'Le format de l’adresse e-mail est invalide.',
    'auth/email-already-in-use': 'Cette adresse e-mail est déjà associée à un compte.',
  };

  if (messages[code]) return `${messages[code]} (\${code})`;
  return code
    ? `Échec de l’authentification Firebase. Code : ${code}. Communique ce code au support.`
    : 'Échec de l’authentification. Vérifie les informations saisies et réessaie.';
};

export const PlatformAdminView: React.FC<{ onBack: () => void; onOpenRestaurant: (slug: string) => void }> = ({ onBack, onOpenRestaurant }) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
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
    catch (error: unknown) { setError(getAuthErrorMessage(error)); }
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
        <label className="block text-sm">Mot de passe<div className="relative mt-1"><input required type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 pr-12"/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
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
        <div className="relative"><input required minLength={10} type={showOwnerPassword ? "text" : "password"} autoComplete="new-password" placeholder="Mot de passe initial (10 caractères min.)" value={form.ownerPassword} onChange={e=>setForm({...form,ownerPassword:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 pr-12"/><button type="button" onClick={()=>setShowOwnerPassword(v=>!v)} aria-label={showOwnerPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showOwnerPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
        <p className="text-xs text-amber-300 md:col-span-2">Transmets le mot de passe initial au propriétaire par un canal privé. Il devra le modifier dès sa première connexion.</p>
        <div className="flex gap-2 md:col-span-2"><button disabled={loading} className="rounded-lg bg-orange-500 px-5 py-2 font-bold">Créer le restaurant</button><button type="button" onClick={()=>setShowCreate(false)} className="rounded-lg border border-slate-700 px-4 py-2">Annuler</button></div>
      </form>}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"><div className="border-b border-slate-800 p-4 font-bold">Établissements ({restaurants.length})</div>{restaurants.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">Aucun restaurant enregistré.</p> : restaurants.map(r=><div key={r.slug} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4 last:border-0"><div className="flex items-center gap-3"><div className="rounded-xl bg-slate-800 p-3"><Building2 size={20}/></div><div><p className="font-bold">{r.name}</p><p className="text-xs text-slate-400">{r.slug} · {r.ownerName || r.ownerEmail || 'Propriétaire non renseigné'}</p></div></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${r.status === 'suspended' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>{r.status === 'suspended' ? 'Suspendu' : 'Actif'}</span><button onClick={()=>onOpenRestaurant(r.slug)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold">Gérer</button><button onClick={()=>setStatus(r,r.status === 'suspended' ? 'active' : 'suspended')} className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-xs">{r.status === 'suspended' ? <CheckCircle2 size={14}/> : <Ban size={14}/>} {r.status === 'suspended' ? 'Réactiver' : 'Suspendre'}</button></div></div>)}</div>
      </>}
    </main>
  </div>;
};
