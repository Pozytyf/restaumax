import React, { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { auth, requestManagerPasswordReset } from '../../lib/firebase';
import { calculateSubscriptionMetrics } from '../../lib/subscriptionMetrics';
import { Building2, ShieldCheck, LogOut, Plus, RefreshCw, Ban, CheckCircle2, Eye, EyeOff } from 'lucide-react';

type RestaurantRow = {
  slug: string; name: string;
  status?: string; isOpen?: boolean; deletedAt?: number;
  subscription?: {
    planName?: string; priceFcfa?: number; currency?: string;
    billingCycle?: 'monthly' | 'yearly' | 'custom';
    status?: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
    startsAt?: number; endsAt?: number; notes?: string;
  };
};
type PlatformSummary = {
  totalRestaurants: number; activeRestaurants: number; suspendedRestaurants: number;
  deletedRestaurants: number; openRestaurants: number; monthlyRecurringRevenueFcfa: number;
  subscriptionsByPlan: Record<string, number>; subscriptionsByStatus: Record<string, number>;
};
type StaffRow = { uid: string; email: string; displayName: string; role: 'owner' | 'manager' | 'staff'; active: boolean; permissions?: string[] };

export const PlatformAdminView: React.FC<{ onBack: () => void; onOpenRestaurant: (slug: string) => void }> = ({ onBack, onOpenRestaurant }) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [expandedRestaurant, setExpandedRestaurant] = useState<string | null>(null);
  const [staffByRestaurant, setStaffByRestaurant] = useState<Record<string, StaffRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [subscriptionRestaurant, setSubscriptionRestaurant] = useState<RestaurantRow | null>(null);
  const [subscriptionForm, setSubscriptionForm] = useState({
    planName: '', priceFcfa: '0', billingCycle: 'monthly',
    status: 'trial', startsOn: '', endsOn: '', notes: ''
  });
  const [form, setForm] = useState({ name: '', ownerName: '', ownerEmail: '' });

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
    try { const data = await request(); setRestaurants(data.restaurants || []); setSummary(data.summary || null); }
    catch (e: any) { setError(e.message || 'Accès super-administrateur refusé.'); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { if (user) refresh(); else { setRestaurants([]); setSummary(null); } }, [user, refresh]);

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
      const ownerEmail = String(result.owner?.email || form.ownerEmail).trim();
      const reset = await requestManagerPasswordReset(ownerEmail);
      setNotice(reset.success
        ? `Restaurant créé. Un e-mail sécurisé a été envoyé à ${ownerEmail} pour que le propriétaire définisse son mot de passe.`
        : `Restaurant créé. Le compte propriétaire est ${ownerEmail}, mais l’e-mail automatique a échoué ; utilisez « Mot de passe oublié ? » à la connexion.`);
      setForm({ name: '', ownerName: '', ownerEmail: '' });
      setShowCreate(false); await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const dateInputFromTimestamp = (value?: number) =>
    value && Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : '';

  const subscriptionStatusLabel = (status?: string) => {
    const labels: Record<string, string> = {
      trial: 'Essai', active: 'Actif', past_due: 'Paiement en retard',
      suspended: 'Suspendu', cancelled: 'Résilié'
    };
    return labels[status || ''] || 'Non défini';
  };

  const billingCycleLabel = (cycle?: string) => {
    const labels: Record<string, string> = {
      monthly: 'mensuel', yearly: 'annuel', custom: 'personnalisé'
    };
    return labels[cycle || ''] || 'période non définie';
  };

  const editSubscription = (restaurant: RestaurantRow) => {
    const subscription = restaurant.subscription || {};
    setSubscriptionRestaurant(restaurant);
    setSubscriptionForm({
      planName: subscription.planName || '',
      priceFcfa: String(subscription.priceFcfa ?? 0),
      billingCycle: subscription.billingCycle || 'monthly',
      status: subscription.status || 'trial',
      startsOn: dateInputFromTimestamp(subscription.startsAt),
      endsOn: dateInputFromTimestamp(subscription.endsAt),
      notes: subscription.notes || ''
    });
  };

  const saveSubscription = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!subscriptionRestaurant) return;
    setLoading(true); setError(''); setNotice('');
    try {
      const priceFcfa = Number(subscriptionForm.priceFcfa);
      const startsAt = Date.parse(`${subscriptionForm.startsOn}T00:00:00.000Z`);
      const endsAt = Date.parse(`${subscriptionForm.endsOn}T23:59:59.999Z`);
      if (!Number.isSafeInteger(priceFcfa) || priceFcfa < 0 || !Number.isFinite(startsAt) ||
          !Number.isFinite(endsAt) || endsAt <= startsAt) {
        throw new Error('Vérifiez le tarif et les dates de validité de l’abonnement.');
      }
      await request({
        action: 'update_subscription',
        slug: subscriptionRestaurant.slug,
        subscription: {
          planName: subscriptionForm.planName.trim(),
          priceFcfa,
          billingCycle: subscriptionForm.billingCycle,
          status: subscriptionForm.status,
          startsAt,
          endsAt,
          notes: subscriptionForm.notes.trim()
        }
      });
      setNotice(`Abonnement de ${subscriptionRestaurant.name} mis à jour.`);
      setSubscriptionRestaurant(null);
      await refresh();
    } catch (e: any) { setError(e.message || 'Mise à jour de l’abonnement impossible.'); }
    finally { setLoading(false); }
  };

  const setStatus = async (restaurant: RestaurantRow, status: 'active' | 'suspended') => {
    setLoading(true); setError('');
    try { await request({ action: 'set_restaurant_status', slug: restaurant.slug, status }); await refresh(); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const toggleRestaurantStaff = async (restaurant: RestaurantRow) => {
    if (expandedRestaurant === restaurant.slug) { setExpandedRestaurant(null); return; }
    setExpandedRestaurant(restaurant.slug); setLoading(true); setError('');
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const response = await fetch(`/api/platform-admin?action=staff_list&slug=${encodeURIComponent(restaurant.slug)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Impossible de charger les comptes.');
      setStaffByRestaurant(previous => ({ ...previous, [restaurant.slug]: data.staff || [] }));
    } catch (e: any) { setError(e.message || 'Lecture des comptes impossible.'); }
    finally { setLoading(false); }
  };

  const setUserStatus = async (restaurant: RestaurantRow, member: StaffRow, status: 'active' | 'suspended') => {
    if (!window.confirm(`Confirmer : ${status === 'active' ? 'réactiver' : 'suspendre'} ${member.displayName} ?`)) return;
    setLoading(true); setError(''); setNotice('');
    try {
      await request({ action: 'set_staff_status', slug: restaurant.slug, uid: member.uid, status });
      setNotice(status === 'active' ? 'Compte réactivé. Une nouvelle connexion est nécessaire.' : 'Compte suspendu et sessions révoquées.');
      const token = await auth.currentUser?.getIdToken(true);
      const response = await fetch(`/api/platform-admin?action=staff_list&slug=${encodeURIComponent(restaurant.slug)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Actualisation impossible.');
      setStaffByRestaurant(previous => ({ ...previous, [restaurant.slug]: data.staff || [] }));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const deleteUser = async (restaurant: RestaurantRow, member: StaffRow) => {
    if (!window.confirm(`Supprimer le compte d'accès de ${member.displayName} ? Les commandes, historiques et données financières seront conservés.`)) return;
    setLoading(true); setError(''); setNotice('');
    try {
      await request({ action: 'delete_staff', slug: restaurant.slug, uid: member.uid });
      setNotice('Compte supprimé. Les données métier sont conservées.');
      const token = await auth.currentUser?.getIdToken(true);
      const response = await fetch(`/api/platform-admin?action=staff_list&slug=${encodeURIComponent(restaurant.slug)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Actualisation impossible.');
      setStaffByRestaurant(previous => ({ ...previous, [restaurant.slug]: data.staff || [] }));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const deleteRestaurant = async (restaurant: RestaurantRow) => {
    const confirmation = window.prompt(`Suppression logique du restaurant ${restaurant.name}. Les commandes et données financières seront conservées. Pour confirmer, saisis exactement : ${restaurant.slug}`);
    if (confirmation !== restaurant.slug) return;
    setLoading(true); setError(''); setNotice('');
    try {
      await request({ action: 'delete_restaurant', slug: restaurant.slug, confirmation });
      setNotice('Restaurant supprimé logiquement. Les accès sont coupés et les données historiques sont conservées.');
      setExpandedRestaurant(null); await refresh();
    } catch (e: any) { setError(e.message); await refresh(); }
    finally { setLoading(false); }
  };

  const subscriptionMetrics = calculateSubscriptionMetrics(restaurants);

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
      </form> : <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-sm text-slate-400">Restaurants enregistrés</p><p className="mt-2 text-3xl font-black">{summary?.totalRestaurants ?? restaurants.length}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-sm text-slate-400">Établissements actifs</p><p className="mt-2 text-3xl font-black">{summary?.activeRestaurants ?? 0}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-sm text-slate-400">Établissements suspendus</p><p className="mt-2 text-3xl font-black">{summary?.suspendedRestaurants ?? 0}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-sm text-slate-400">Restaurants ouverts</p><p className="mt-2 text-3xl font-black">{summary?.openRestaurants ?? 0}</p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-sm text-slate-400">Revenu mensuel récurrent</p><p className="mt-2 text-2xl font-black">{Number(summary?.monthlyRecurringRevenueFcfa || 0).toLocaleString('fr-FR')} <span className="text-sm">FCFA</span></p></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-sm text-slate-400">Compte connecté</p><p className="mt-2 truncate text-sm font-bold">{user.email}</p></div>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">Abonnements actifs valides</p>
          <p className="mt-2 text-2xl font-black text-emerald-300">{subscriptionMetrics.activeSubscriptionCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">Périodes d’essai en cours</p>
          <p className="mt-2 text-2xl font-black text-sky-300">{subscriptionMetrics.trialSubscriptionCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs text-slate-400">À régulariser / expirés</p>
          <p className="mt-2 text-2xl font-black text-amber-300">{subscriptionMetrics.attentionSubscriptionCount}</p>
        </div>
      </section>
      <p className="text-xs text-slate-500">Les essais et abonnements expirés sont exclus des indicateurs valides. Le MRR affiché reste une estimation contractuelle, pas un encaissement constaté.</p>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="mb-2 text-sm font-bold text-slate-300">Abonnements par plan</p>
        <div className="flex flex-wrap gap-2">{Object.entries(summary?.subscriptionsByPlan || {}).map(([plan, count]) =>
          <span key={plan} className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{plan} : {count}</span>)}</div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">Gestion des restaurants</h2><p className="text-sm text-slate-400">Création, attribution du propriétaire et activation des établissements.</p></div><div className="flex gap-2"><button onClick={refresh} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm"><RefreshCw size={15}/> Actualiser</button><button onClick={()=>setShowCreate(v=>!v)} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold"><Plus size={16}/> Nouveau restaurant</button></div></div>
      {showCreate && <form onSubmit={createRestaurant} className="grid gap-3 rounded-2xl border border-slate-700 bg-slate-900 p-5 md:grid-cols-2">
        <h3 className="md:col-span-2 text-lg font-bold">Enregistrer un restaurant et son propriétaire</h3>
        <input required placeholder="Nom du restaurant" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        <input required placeholder="Nom complet du propriétaire" value={form.ownerName} onChange={e=>setForm({...form,ownerName:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        <input required type="email" placeholder="E-mail du propriétaire" value={form.ownerEmail} onChange={e=>setForm({...form,ownerEmail:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        <p className="text-xs text-emerald-300 md:col-span-2">Après création, un e-mail Firebase sécurisé est envoyé au propriétaire pour qu’il définisse lui-même son mot de passe. Aucun mot de passe temporaire n’est demandé ni transmis.</p>
        <div className="flex gap-2 md:col-span-2"><button disabled={loading} className="rounded-lg bg-orange-500 px-5 py-2 font-bold">Créer le restaurant</button><button type="button" onClick={()=>setShowCreate(false)} className="rounded-lg border border-slate-700 px-4 py-2">Annuler</button></div>
      </form>}
      {subscriptionRestaurant && <form onSubmit={saveSubscription} className="grid gap-3 rounded-2xl border border-violet-800 bg-slate-900 p-5 md:grid-cols-2">
        <div className="md:col-span-2 flex items-start justify-between gap-3">
          <div><h3 className="text-lg font-bold">Abonnement · {subscriptionRestaurant.name}</h3>
            <p className="text-xs text-slate-400">Gestion manuelle du plan et de sa période. Aucun prélèvement automatique ni blocage d’accès à échéance n’est déclenché pour le moment.</p></div>
          <button type="button" onClick={() => setSubscriptionRestaurant(null)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs">Fermer</button>
        </div>
        <label className="text-sm">Nom du plan
          <input required minLength={2} maxLength={80} value={subscriptionForm.planName}
            onChange={e=>setSubscriptionForm({...subscriptionForm,planName:e.target.value})}
            placeholder="Ex. Essentiel, Pro, Premium"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        </label>
        <label className="text-sm">Tarif (FCFA)
          <input required type="number" min="0" max="1000000000" step="1" value={subscriptionForm.priceFcfa}
            onChange={e=>setSubscriptionForm({...subscriptionForm,priceFcfa:e.target.value})}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        </label>
        <label className="text-sm">Périodicité
          <select value={subscriptionForm.billingCycle} onChange={e=>setSubscriptionForm({...subscriptionForm,billingCycle:e.target.value})}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3">
            <option value="monthly">Mensuelle</option><option value="yearly">Annuelle</option><option value="custom">Personnalisée</option>
          </select>
        </label>
        <label className="text-sm">Statut
          <select value={subscriptionForm.status} onChange={e=>setSubscriptionForm({...subscriptionForm,status:e.target.value})}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3">
            <option value="trial">Essai</option><option value="active">Actif</option><option value="past_due">Paiement en retard</option>
            <option value="suspended">Suspendu</option><option value="cancelled">Résilié</option>
          </select>
        </label>
        <label className="text-sm">Début de validité
          <input required type="date" value={subscriptionForm.startsOn}
            onChange={e=>setSubscriptionForm({...subscriptionForm,startsOn:e.target.value})}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        </label>
        <label className="text-sm">Fin de validité
          <input required type="date" value={subscriptionForm.endsOn}
            onChange={e=>setSubscriptionForm({...subscriptionForm,endsOn:e.target.value})}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        </label>
        <label className="text-sm md:col-span-2">Notes internes (facultatif)
          <textarea maxLength={500} value={subscriptionForm.notes}
            onChange={e=>setSubscriptionForm({...subscriptionForm,notes:e.target.value})}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"/>
        </label>
        <div className="flex gap-2 md:col-span-2">
          <button disabled={loading} className="rounded-lg bg-violet-600 px-5 py-2 font-bold disabled:opacity-50">Enregistrer l’abonnement</button>
          <button type="button" onClick={()=>setSubscriptionRestaurant(null)} className="rounded-lg border border-slate-700 px-4 py-2">Annuler</button>
        </div>
      </form>}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"><div className="border-b border-slate-800 p-4 font-bold">Établissements ({restaurants.length})</div>{restaurants.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">Aucun restaurant enregistré.</p> : restaurants.map(r=><React.Fragment key={r.slug}><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-slate-800 p-3"><Building2 size={20}/></div><div><p className="font-bold">{r.name}</p><p className="text-xs text-slate-400">{r.slug} · Identité du propriétaire protégée dans la vue synthèse</p>
                      <p className="text-[11px] text-violet-300">
                        {r.subscription?.planName
                          ? `${r.subscription.planName} · ${Number(r.subscription.priceFcfa || 0).toLocaleString('fr-FR')} FCFA · ${billingCycleLabel(r.subscription.billingCycle)} · ${subscriptionStatusLabel(r.subscription.status)}`
                          : 'Abonnement non configuré'}
                        {r.subscription?.endsAt ? ` · échéance ${new Date(r.subscription.endsAt).toLocaleDateString('fr-FR')}` : ''}
                      </p></div></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${r.status === 'deleted' || r.deletedAt ? 'bg-slate-700 text-slate-300' : r.status === 'suspended' ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'}`}>{r.status === 'deleted' || r.deletedAt ? 'Supprimé' : r.status === 'suspended' ? 'Suspendu' : 'Actif'}</span>{r.status !== 'deleted' && !r.deletedAt && <><button onClick={()=>onOpenRestaurant(r.slug)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold">Gérer</button><button disabled={loading} onClick={()=>editSubscription(r)} className="rounded-lg border border-violet-800 px-3 py-2 text-xs font-bold text-violet-300">Abonnement</button><button disabled={loading} onClick={()=>setStatus(r,r.status === 'suspended' ? 'active' : 'suspended')} className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-2 text-xs">{r.status === 'suspended' ? <CheckCircle2 size={14}/> : <Ban size={14}/>} {r.status === 'suspended' ? 'Réactiver' : 'Suspendre'}</button><button disabled={loading} onClick={()=>deleteRestaurant(r)} className="rounded-lg border border-rose-900 px-3 py-2 text-xs font-bold text-rose-300">Supprimer</button></>}<button disabled={loading} onClick={()=>toggleRestaurantStaff(r)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold">{expandedRestaurant === r.slug ? 'Masquer les comptes' : 'Gérer les comptes'}</button></div></div>{expandedRestaurant === r.slug && <div className="space-y-3 border-b border-slate-800 bg-slate-950/60 p-4">{(staffByRestaurant[r.slug] || []).map(member=><div key={member.uid} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 p-3"><div><p className="font-bold text-sm">{member.displayName} <span className="text-xs text-slate-400">· {member.role === 'owner' ? 'Propriétaire' : member.role === 'manager' ? 'Gérant' : 'Serveur / Personnel'}</span></p><p className="text-xs text-slate-400">{member.email} · {member.active ? 'Actif' : 'Suspendu'}</p></div><div className="flex gap-2">{member.active ? <button disabled={loading || r.status === 'deleted' || Boolean(r.deletedAt)} onClick={()=>setUserStatus(r,member,'suspended')} className="rounded-lg border border-rose-900 px-3 py-2 text-xs text-rose-300">Suspendre</button> : <button disabled={loading || r.status !== 'active'} onClick={()=>setUserStatus(r,member,'active')} className="rounded-lg border border-emerald-900 px-3 py-2 text-xs text-emerald-300">Réactiver</button>}<button disabled={loading || r.status === 'deleted' || Boolean(r.deletedAt)} onClick={()=>deleteUser(r,member)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Supprimer</button></div></div>)}{(staffByRestaurant[r.slug] || []).length === 0 && <p className="text-sm text-slate-400">Aucun compte associé.</p>}<p className="text-xs text-slate-500">Les comptes propriétaires ne peuvent être supprimés que par le super-administrateur. Les historiques métier sont conservés.</p></div>}</React.Fragment>)}</div>
      </>}
    </main>
  </div>;
};
