import React, { useCallback, useEffect, useState } from 'react';
import { auth } from '../../lib/firebase';
import { ArrowLeft, UserPlus, Shield, UserX, RefreshCw, Eye, EyeOff } from 'lucide-react';

const PERMISSIONS = [
  ['menu.view', 'Consulter le menu'], ['menu.manage', 'Modifier le menu'],
  ['orders.view', 'Consulter les commandes'], ['orders.manage', 'Gérer les commandes'],
  ['tables.view', 'Consulter les tables'], ['tables.manage', 'Gérer les tables'],
  ['pos.access', 'Accéder à la caisse'], ['kitchen.access', 'Accéder à la cuisine'],
  ['cash.view', 'Consulter la caisse'], ['cash.manage', 'Gérer les encaissements'],
  ['reports.view', 'Consulter les rapports'], ['customers.view', 'Consulter les clients'], ['customers.manage', 'Gérer les clients'], ['inventory.view', 'Consulter les stocks'], ['inventory.manage', 'Gérer les stocks'], ['staff.view', 'Consulter le personnel'],
  ['staff.manage', 'Gérer le personnel'], ['settings.view', 'Consulter les paramètres'],
  ['settings.manage', 'Modifier les paramètres']
] as const;

type StaffMember = { uid: string; email: string; displayName: string; role: 'owner'|'manager'|'staff'; permissions: string[]; active: boolean };

export const StaffManagementView: React.FC<{ restaurantSlug: string; onBack: () => void }> = ({ restaurantSlug, onBack }) => {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<'manager'|'staff'>('staff');
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff' as 'manager'|'staff', permissions: ['menu.view','orders.view','tables.view','kitchen.access'] });

  const request = useCallback(async (body?: Record<string, unknown>) => {
    if (!auth.currentUser) throw new Error('Session expirée.');
    const token = await auth.currentUser.getIdToken(true);
    const response = await fetch('/api/platform-admin', {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Opération refusée.');
    return data;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const token = await auth.currentUser?.getIdToken(true); const response = await fetch(`/api/platform-admin?action=staff_list&slug=${encodeURIComponent(restaurantSlug)}`, { headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.error || 'Lecture impossible.'); setStaff(result.staff || []); }
    catch (e: any) { setError(e.message || 'Impossible de charger le personnel.'); }
    finally { setLoading(false); }
  }, [request, restaurantSlug]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); setLoading(true);
    try {
      await request({ action: 'create_staff', slug: restaurantSlug, ...form });
      setNotice('Compte créé. Remettez les identifiants à la personne concernée de manière privée.');
      setForm({ name: '', email: '', password: '', role: 'staff', permissions: ['menu.view','orders.view','tables.view','kitchen.access'] });
      await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const disable = async (member: StaffMember) => {
    if (!window.confirm(`Désactiver le compte de ${member.displayName} ?`)) return;
    setLoading(true);
    try { await request({ action: 'disable_staff', slug: restaurantSlug, uid: member.uid }); await refresh(); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const beginEdit = (member: StaffMember) => {
    setEditingUid(member.uid);
    setEditRole(member.role === 'manager' ? 'manager' : 'staff');
    setEditPermissions(member.role === 'manager' ? [...new Set([...(member.permissions || []), 'tables.manage'])] : (member.permissions || []));
  };

  const saveEdit = async (uid: string) => {
    setLoading(true); setError('');
    try {
      await request({ action: 'update_staff', slug: restaurantSlug, uid, role: editRole, permissions: editPermissions });
      setEditingUid(null); setNotice('Autorisations mises à jour. Le membre devra se reconnecter pour renouveler ses droits.');
      await refresh();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const toggleEditPermission = (permission: string) => setEditPermissions(prev =>
    prev.includes(permission) ? prev.filter(p => p !== permission) : [...prev, permission]
  );

  const togglePermission = (permission: string) => setForm(prev => ({
    ...prev, permissions: prev.permissions.includes(permission)
      ? prev.permissions.filter(p => p !== permission) : [...prev.permissions, permission]
  }));

  return <div className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
    <div className="mx-auto max-w-5xl space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={16}/> Retour au centre de gestion</button>
      <div><h1 className="text-2xl font-black">Personnel et autorisations</h1><p className="text-sm text-slate-500">Le propriétaire conserve le contrôle des comptes et des permissions de son restaurant.</p></div>
      {error && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {notice && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
      <form onSubmit={create} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-bold"><UserPlus size={18}/> Ajouter un membre du personnel</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input required placeholder="Nom complet" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="rounded-lg border border-slate-300 p-3"/>
          <input required type="email" placeholder="Adresse e-mail" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} className="rounded-lg border border-slate-300 p-3"/>
          <div className="relative"><input required minLength={10} type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Mot de passe initial (10 caractères min.)" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} className="w-full rounded-lg border border-slate-300 p-3 pr-12"/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
          <select value={form.role} onChange={e=>{const role=e.target.value as 'manager'|'staff';setForm(prev=>({...prev,role,permissions:role==='manager'?[...new Set([...prev.permissions,'tables.manage'])]:prev.permissions}));}} className="rounded-lg border border-slate-300 p-3"><option value="staff">Personnel</option><option value="manager">Gérant</option></select>
        </div>
        <div><p className="mb-2 text-sm font-bold">Autorisations accordées</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PERMISSIONS.map(([id,label])=><label key={id} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm"><input type="checkbox" checked={form.permissions.includes(id)} onChange={()=>togglePermission(id)}/>{label}</label>)}</div></div>
        <p className="text-xs text-amber-700">Les autorisations sont appliquées côté serveur et dans les règles Firestore. Ne partagez pas les mots de passe par un canal public.</p>
        <button disabled={loading} className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">Créer le compte</button>
      </form>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4"><h2 className="font-bold">Comptes du restaurant</h2><button onClick={refresh} disabled={loading} className="flex items-center gap-2 text-sm"><RefreshCw size={14}/> Actualiser</button></div>
        {staff.map(member=><div key={member.uid} className="border-b border-slate-100 p-4 last:border-0">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold">{member.displayName} {member.role === 'owner' && <span className="text-xs text-orange-600">· Propriétaire</span>}</p><p className="text-xs text-slate-500">{member.email} · {member.role === 'manager' ? 'Gérant' : member.role === 'owner' ? 'Propriétaire' : 'Personnel'}</p><p className="mt-1 text-xs text-slate-500">{member.permissions?.length || 0} autorisation(s) · {member.active ? 'Actif' : 'Désactivé'}</p></div>{member.role !== 'owner' && <div className="flex gap-2">{member.active && <button onClick={()=>beginEdit(member)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">Modifier les droits</button>}{member.active && <button onClick={()=>disable(member)} className="flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700"><UserX size={14}/> Désactiver</button>}</div>}</div>
          {editingUid === member.uid && <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4"><select value={editRole} onChange={e=>setEditRole(e.target.value as 'manager'|'staff')} className="rounded-lg border border-slate-300 bg-white p-2 text-sm"><option value="staff">Personnel</option><option value="manager">Gérant</option></select><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PERMISSIONS.map(([id,label])=><label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editPermissions.includes(id)} onChange={()=>toggleEditPermission(id)}/>{label}</label>)}</div><div className="flex gap-2"><button disabled={loading} onClick={()=>saveEdit(member.uid)} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white">Enregistrer les droits</button><button onClick={()=>setEditingUid(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs">Annuler</button></div></div>}
        </div>)}
        {staff.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Aucun membre enregistré.</p>}
      </section>
    </div>
  </div>;
};
