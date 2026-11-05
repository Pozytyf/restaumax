import React, { useState } from 'react';
import { auth } from '../../lib/firebase';

interface Props {
  restaurantSlug: string;
  isOwner: boolean;
}

export const PayDunyaAccountSettings: React.FC<Props> = ({ restaurantSlug, isOwner }) => {
  const [masterKey, setMasterKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');

  if (!isOwner || !restaurantSlug) return null;

  async function submit(enabled: boolean) {
    const user = auth.currentUser;
    if (!user) {
      setMessage('Reconnectez-vous pour gérer le compte marchand.');
      return;
    }
    if (enabled && (!masterKey.trim() || !privateKey.trim() || !token.trim())) {
      setMessage('Renseignez les trois clés API PayDunya du compte de ce restaurant.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const idToken = await user.getIdToken(true);
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          action: 'configure_paydunya_account',
          restaurantSlug,
          enabled,
          mode: 'test',
          masterKey,
          privateKey,
          token
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Configuration PayDunya refusée.');
      setConnected(enabled);
      setMasterKey('');
      setPrivateKey('');
      setToken('');
      setMessage(enabled
        ? 'Compte PayDunya TEST connecté. Les clés ont été chiffrées côté serveur.'
        : 'Compte PayDunya déconnecté. Les paiements en attente restent rapprochables.');
    } catch (error: any) {
      setMessage(String(error?.message || 'Impossible de mettre à jour le compte PayDunya.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
      <div>
        <h2 className="text-base font-black text-[#101d2d]">Compte marchand PayDunya</h2>
        <p className="mt-1 text-xs text-slate-500">
          Connectez le compte PayDunya appartenant à ce restaurant. Les encaissements sont versés directement sur ce compte ; RestauMax ne centralise pas les fonds.
        </p>
      </div>
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        Mode TEST uniquement pour cette première configuration. Les clés sont transmises au serveur par HTTPS et chiffrées avant stockage. Ne les partagez jamais avec le personnel.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-slate-700">
          Master Key
          <input type="password" autoComplete="off" value={masterKey} onChange={e => setMasterKey(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Private Key TEST
          <input type="password" autoComplete="off" value={privateKey} onChange={e => setPrivateKey(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Token
          <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void submit(true)}
          className="rounded-lg bg-[#ff6500] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
          {busy ? 'Enregistrement…' : 'Connecter le compte TEST'}
        </button>
        <button type="button" disabled={busy} onClick={() => void submit(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">
          Déconnecter
        </button>
        {connected === true && <span className="text-xs font-semibold text-emerald-700">Connecté (TEST)</span>}
        {connected === false && <span className="text-xs font-semibold text-slate-600">Déconnecté</span>}
      </div>
      {message && <p role="status" className="text-xs text-slate-700">{message}</p>}
    </section>
  );
};
