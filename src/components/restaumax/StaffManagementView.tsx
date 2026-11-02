import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '../../lib/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import { ArrowLeft, UserPlus, UserX, RefreshCw, Eye, EyeOff, Search, Mail, ShieldCheck, Users } from 'lucide-react';

const PERMISSIONS = [
  ['menu.view', 'Consulter le menu'], ['menu.manage', 'Modifier le menu'],
  ['orders.view', 'Consulter les commandes'], ['orders.manage', 'Gérer les commandes'],
  ['tables.view', 'Consulter les tables'], ['tables.manage', 'Gérer les tables'],
  ['pos.access', 'Accéder à la caisse'], ['kitchen.access', 'Accéder à la cuisine'],
  ['cash.view', 'Consulter la caisse'], ['cash.manage', 'Gérer les encaissements'],
  ['reports.view', 'Consulter les rapports'], ['customers.view', 'Consulter les clients'],
  ['customers.manage', 'Gérer les clients'], ['inventory.view', 'Consulter les stocks'],
  ['inventory.manage', 'Gérer les stocks'], ['staff.view', 'Consulter le personnel'],
  ['staff.manage', 'Gérer le personnel'], ['settings.view', 'Consulter les paramètres'],
  ['settings.manage', 'Modifier les paramètres']
] as const;

const JOBS = [
  { id: 'server', label: 'Serveur / Serveuse', permissions: ['menu.view','orders.view','orders.manage','tables.view','pos.access'] },
  { id: 'cashier', label: 'Caissier / Caissière', permissions: ['orders.view','pos.access','cash.view','cash.manage'] },
  { id: 'cook', label: 'Cuisinier / Cuisinière', permissions: ['orders.view','kitchen.access'] },
  { id: 'manager', label: 'Gérant / Gérante', permissions: ['menu.view','menu.manage','orders.view','orders.manage','tables.view','tables.manage','pos.access','kitchen.access','cash.view','cash.manage','reports.view','customers.view','customers.manage','inventory.view','inventory.manage','staff.view','staff.manage','settings.view'] },
  { id: 'other', label: 'Autre fonction', permissions: ['menu.view','orders.view'] }
] as const;

type StaffMember = { uid: string; email: string; displayName: string; role: 'owner'|'manager'|'staff'; jobTitle?: string; permissions: string[]; active: boolean; createdAt?: number };
type StaffAuditEvent = { id: string; event: string; targetUid: string; actorEmail?: string | null; createdAt: number; details?: Record<string, unknown> };

export const StaffManagementView: React.FC<{ restaurantSlug: string; onBack: () => void }> = ({ restaurantSlug, onBack }) => {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [auditEvents, setAuditEvents] = useState<StaffAuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [jobFilter, setJobFilter] = useState('all');
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState<{ name: string; email: string; password: string; jobTitle: string; role: 'manager'|'staff'; permissions: string[] }>({ name: '', email: '', password: '', jobTitle: 'server', role: 'staff', permissions: [...JOBS[0].permissions] });

  const request = useCallback(async (body?: Record<string, unknown>, action = 'staff_list') => {
    if (!auth.currentUser) throw new Error('Session expirée. Reconnectez-vous.');
    const token = await auth.currentUser.getIdToken(true);
    const response = await fetch(body ? '/api/platform-admin' : `/api/platform-admin?action=${action}&slug=${encodeURIComponent(restaurantSlug)}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Opération refusée.');
    return data;
  }, [restaurantSlug]);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const [result, audit] = await Promise.all([request(), request(undefined, 'staff_audit')]); setStaff(result.staff || []); setAuditEvents(audit.events || []); }
    catch (e: any) { setError(e.message || 'Impossible de charger le personnel.'); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { refresh(); }, [refresh]);

  const visibleStaff = useMemo(() => staff.filter(member => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || member.displayName.toLowerCase().includes(q) || member.email.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? member.active : !member.active);
    const matchesJob = jobFilter === 'all' || (jobFilter === 'owner' ? member.role === 'owner' : member.jobTitle === jobFilter || (jobFilter === 'manager' && member.role === 'manager'));
    return matchesSearch && matchesStatus && matchesJob;
  }), [staff, search, statusFilter, jobFilter]);

  const chooseJob = (jobTitle: string) => {
    const job = JOBS.find(item => item.id === jobTitle) || JOBS[0];
    setForm(prev => ({ ...prev, jobTitle, role: jobTitle === 'manager' ? 'manager' : 'staff', permissions: [...job.permissions] }));
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setNotice('');
    if (form.password.length < 10) { setError('Le mot de passe initial doit contenir au moins 10 caractères.'); return; }
    setLoading(true);
    try {
      await request({ action: 'create_staff', slug: restaurantSlug, ...form });
      setNotice('Compte créé. Communiquez les identifiants au membre par un canal privé et demandez-lui de changer son mot de passe.');
      setForm({ name: '', email: '', password: '', jobTitle: 'server', role: 'staff', permissions: [...JOBS[0].permissions] });
      await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const disable = async (member: StaffMember) => {
    if (!window.confirm(`Désactiver le compte de ${member.displayName} ? Ses sessions seront révoquées.`)) return;
    setLoading(true); setError('');
    try { await request({ action: 'disable_staff', slug: restaurantSlug, uid: member.uid }); setNotice('Compte désactivé et sessions révoquées.'); await refresh(); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const resetPassword = async (member: StaffMember) => {
    if (!window.confirm(`Envoyer un lien de réinitialisation à ${member.email} ?`)) return;
    setLoading(true); setError(''); setNotice('');
    try { await sendPasswordResetEmail(auth, member.email); setNotice(`Lien de réinitialisation envoyé à ${member.email}.`); }
    catch { setError('Impossible d’envoyer le lien. Vérifiez la configuration des modèles e-mail Firebase.'); }
    finally { setLoading(false); }
  };

  const togglePermission = (permission: string) => setForm(prev => ({
    ...prev, permissions: prev.permissions.includes(permission) ? prev.permissions.filter(p => p !== permission) : [...prev.permissions, permission]
  }));

  return <div className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={16}/> Retour au centre de gestion</button>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-black">Personnel du restaurant</h1><p className="text-sm text-slate-500">Comptes individuels, fonctions professionnelles et autorisations.</p></div><div className="flex gap-2 rounded-xl bg-white px-4 py-3 shadow-sm border"><Users size={18}/><strong>{staff.length}</strong><span className="text-sm text-slate-500">comptes</span><span className="text-slate-300">·</span><strong>{staff.filter(m=>m.active).length}</strong><span className="text-sm text-slate-500">actifs</span></div></div>
      {error && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
      <form onSubmit={create} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-bold"><UserPlus size={18}/> Créer un compte individuel</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input required maxLength={120} placeholder="Nom complet" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="rounded-lg border border-slate-300 p-3"/>
          <input required type="email" placeholder="Adresse e-mail personnelle ou professionnelle" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} className="rounded-lg border border-slate-300 p-3"/>
          <select value={form.jobTitle} onChange={e=>chooseJob(e.target.value)} className="rounded-lg border border-slate-300 p-3">{JOBS.map(job=><option key={job.id} value={job.id}>{job.label}</option>)}</select>
          <div className="relative"><input required minLength={10} type={showPassword?'text':'password'} autoComplete="new-password" placeholder="Mot de passe initial (10 caractères min.)" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} className="w-full rounded-lg border border-slate-300 p-3 pr-12"/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Masquer le mot de passe':'Afficher le mot de passe'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
        </div>
        <div><p className="mb-2 text-sm font-bold">Autorisations attribuées à cette fonction (personnalisables)</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PERMISSIONS.map(([id,label])=><label key={id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm"><input type="checkbox" checked={form.permissions.includes(id)} onChange={()=>togglePermission(id)}/>{label}</label>)}</div></div>
        <p className="text-xs text-amber-700">Les droits sont contrôlés côté serveur. Ne partagez jamais le mot de passe dans un canal public.</p>
        <button disabled={loading} className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{loading?'Création…':'Créer le compte'}</button>
      </form>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-3">
          <label className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un employé…" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"/></label>
          <select value={jobFilter} onChange={e=>setJobFilter(e.target.value)} className="rounded-lg border border-slate-300 p-2 text-sm"><option value="all">Toutes les fonctions</option><option value="owner">Propriétaire</option>{JOBS.map(job=><option key={job.id} value={job.id}>{job.label}</option>)}</select>
          <div className="flex gap-2"><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 p-2 text-sm"><option value="all">Tous les statuts</option><option value="active">Actifs</option><option value="inactive">Désactivés</option></select><button onClick={refresh} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm"><RefreshCw size={14}/> Actualiser</button></div>
        </div>
        {visibleStaff.map(member=><div key={member.uid} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 last:border-0">
          <div className="min-w-0"><p className="font-bold">{member.displayName} {member.role==='owner'&&<span className="text-xs text-orange-600">· Propriétaire</span>}</p><p className="text-xs text-slate-500">{member.email}</p><p className="mt-1 text-xs text-slate-600">{member.role==='owner'?'Propriétaire':JOBS.find(j=>j.id===member.jobTitle)?.label || (member.role==='manager'?'Gérant':'Personnel')} · {member.permissions?.length||0} autorisations</p><span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${member.active?'bg-emerald-100 text-emerald-800':'bg-rose-100 text-rose-800'}`}>{member.active?'Actif':'Désactivé'}</span></div>
          {member.role!=='owner'&&member.active&&<div className="flex flex-wrap gap-2"><button onClick={()=>resetPassword(member)} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold"><Mail size={14}/> Réinitialiser le mot de passe</button><button onClick={()=>disable(member)} className="flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700"><UserX size={14}/> Désactiver</button></div>}
        </div>)}
        {visibleStaff.length===0&&<p className="p-8 text-center text-sm text-slate-500">Aucun membre ne correspond aux filtres.</p>}
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4"><h2 className="font-bold">Journal de sécurité du personnel</h2><p className="text-xs text-slate-500">100 dernières opérations d’administration, accessibles au propriétaire.</p></div>
        {auditEvents.length === 0 ? <p className="p-5 text-sm text-slate-500">Aucun événement enregistré pour le moment.</p> : auditEvents.map(event => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4 last:border-0"><div><p className="text-sm font-bold">{event.event === 'staff.created' ? 'Compte créé' : event.event === 'staff.disabled' ? 'Compte désactivé' : event.event === 'staff.permissions_updated' ? 'Autorisations modifiées' : event.event}</p><p className="text-xs text-slate-500">Cible : {event.targetUid} · Par : {event.actorEmail || 'Administrateur'}</p></div><time className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString('fr-FR')}</time></div>)}
      </section>
    </div>
  </div>;
};
