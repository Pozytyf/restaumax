import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, ShieldCheck, Trash2, AlertTriangle, LockKeyhole } from 'lucide-react';
import {
  deleteJekoPaymentConfigWithServerValidation,
  getJekoPaymentConfigStatusWithServerValidation,
  JekoPaymentConfigStatus,
  saveJekoPaymentConfigWithServerValidation
} from '../../lib/firebase';

interface PaymentSettingsViewProps {
  restaurantSlug: string;
  canManage: boolean;
}

export const PaymentSettingsView: React.FC<PaymentSettingsViewProps> = ({ restaurantSlug, canManage }) => {
  const [status, setStatus] = useState<JekoPaymentConfigStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ apiKeyId: '', apiKey: '', storeId: '', webhookSecret: '' });

  const loadStatus = async () => {
    setLoadingStatus(true);
    const result = await getJekoPaymentConfigStatusWithServerValidation(restaurantSlug);
    if (result.success) setStatus(result.status || null);
    else setError(result.error || 'Impossible de lire la configuration.');
    setLoadingStatus(false);
  };

  useEffect(() => { void loadStatus(); }, [restaurantSlug]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true); setError(''); setNotice('');
    const result = await saveJekoPaymentConfigWithServerValidation(restaurantSlug, form);
    if (result.success) {
      setStatus(result.status || null);
      setForm({ apiKeyId: '', apiKey: '', storeId: '', webhookSecret: '' });
      setNotice('Identifiants enregistrés et chiffrés côté serveur. Le paiement Mobile Money reste désactivé jusqu’à la mise en service et la vérification du webhook.');
    } else {
      setError(result.error || 'Enregistrement impossible.');
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!canManage || !window.confirm('Retirer les identifiants Jèko de ce restaurant ? Les paiements Mobile Money seront indisponibles.')) return;
    setRemoving(true); setError(''); setNotice('');
    const result = await deleteJekoPaymentConfigWithServerValidation(restaurantSlug);
    if (result.success) {
      setStatus({ configured: false, provider: null, storeIdMasked: null, updatedAt: null });
      setNotice('Configuration Jèko retirée.');
    } else {
      setError(result.error || 'Suppression impossible.');
    }
    setRemoving(false);
  };

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText('https://restaumax.vercel.app/api/webhooks/jeko');
      setNotice('URL copiée. Elle sera utilisable après déploiement de la passerelle webhook.');
    } catch {
      setError('Copie impossible dans ce navigateur.');
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <LockKeyhole size={18} className="text-[#ff6500]" />
            <h3 className="text-base font-black text-slate-900">Connexion Mobile Money — Jèko</h3>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Chaque restaurant connecte son propre compte marchand. Les clés sont chiffrées avant leur stockage et ne sont jamais renvoyées à l’interface.
          </p>
        </div>
        {loadingStatus ? (
          <span className="text-xs text-slate-500">Vérification…</span>
        ) : status?.configured ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            <CheckCircle2 size={14}/> Identifiants enregistrés
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Non configuré</span>
        )}
      </div>

      {status?.configured && (
        <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
          Magasin Jèko associé : <strong>{status.storeIdMasked}</strong>
          <span className="block text-xs mt-1">La présence des identifiants ne signifie pas que le paiement en ligne est déjà activé.</span>
        </div>
      )}

      {!canManage ? (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldCheck size={16} className="inline mr-2"/>Seul le propriétaire du restaurant peut configurer les identifiants de paiement.
        </div>
      ) : (
        <form onSubmit={save} className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            Identifiant de clé API (API Key ID)
            <input required value={form.apiKeyId} onChange={e=>setForm({...form,apiKeyId:e.target.value})} autoComplete="off" className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal" placeholder="Identifiant fourni par Jèko"/>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Clé API Jèko
            <input required type="password" value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})} autoComplete="new-password" className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal" placeholder="Clé secrète"/>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Store ID
            <input required value={form.storeId} onChange={e=>setForm({...form,storeId:e.target.value})} autoComplete="off" className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal" placeholder="UUID du magasin Jèko"/>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Secret de signature du webhook
            <input required type="password" value={form.webhookSecret} onChange={e=>setForm({...form,webhookSecret:e.target.value})} autoComplete="new-password" className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal" placeholder="Secret configuré dans Jèko"/>
          </label>

          <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-slate-700">URL webhook RestauMax</p>
                <p className="mt-1 break-all text-xs text-slate-600">https://restaumax.vercel.app/api/webhooks/jeko</p>
              </div>
              <button type="button" onClick={copyWebhookUrl} className="inline-flex shrink-0 items-center gap-1 rounded-lg border bg-white px-3 py-2 text-xs font-bold text-slate-700">
                <Copy size={14}/> Copier
              </button>
            </div>
          </div>

          <div className="md:col-span-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0"/>
            Jèko ne fournit pas de bac à sable classique. Utilisez un magasin de test séparé. Toute transaction réelle de vérification peut débiter un portefeuille et entraîner des frais. N’effectuez aucun paiement de test sans l’avoir décidé.
          </div>

          {error && <p className="md:col-span-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          {notice && <p className="md:col-span-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
            {status?.configured ? (
              <button type="button" disabled={removing || saving} onClick={remove} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-4 py-3 text-sm font-bold text-rose-700 disabled:opacity-50">
                {removing ? <Loader2 size={16} className="animate-spin"/> : <Trash2 size={16}/>} Retirer la configuration
              </button>
            ) : <span/>}
            <button type="submit" disabled={saving || removing} className="inline-flex items-center gap-2 rounded-lg bg-[#101d2d] px-5 py-3 text-sm font-black text-white disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin"/> : <ShieldCheck size={16}/>} Enregistrer les identifiants
            </button>
          </div>
        </form>
      )}
      {error && !canManage && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {notice && !canManage && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    </section>
  );
};
