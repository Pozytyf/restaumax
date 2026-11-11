import React, { useEffect, useState } from 'react';
import { RestauOrder } from '../../types/restaumax';
import { formatFCFA } from '../../utils/format';
import { sounds } from '../../utils/audio';
import { 
  CheckCircle2, 
  Clock, 
  MapPin, 
  ShoppingBag, 
  X, 
  ChefHat, 
  Receipt, 
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface OrderConfirmationModalProps {
  order: RestauOrder | null;
  restaurantName: string;
  onClose: () => void;
  onNewOrder: () => void;
  onStartPayDunyaPayment?: (order: RestauOrder, channel: 'orange-money-ci' | 'wave-ci' | 'mtn-ci' | 'moov-ci' | 'djamo-ci', amount: number) => Promise<void>;
  onSelectCashPayment?: (order: RestauOrder) => Promise<{ success: boolean; error?: string }>;
  customerAccessToken?: string | null;
  onCustomerOrderMutation?: (mutation: { action: 'get' | 'cancel' | 'edit'; reason?: string; items?: Array<{ id: string; quantity: number; prepNotes?: string }> }) => Promise<{ success: boolean; error?: string; subtotalAmount?: number; taxAmount?: number; totalAmount?: number; itemsCount?: number; order?: RestauOrder }>;
}

export const OrderConfirmationModal: React.FC<OrderConfirmationModalProps> = ({
  order,
  restaurantName,
  onClose,
  onNewOrder,
  onStartPayDunyaPayment,
  onSelectCashPayment,
  customerAccessToken,
  onCustomerOrderMutation
}) => {
  const [selectedChannel, setSelectedChannel] = useState<'orange-money-ci' | 'wave-ci' | 'mtn-ci' | 'moov-ci' | 'djamo-ci'>('wave-ci');
  const [isStartingPayment, setIsStartingPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [isSelectingCash, setIsSelectingCash] = useState(false);
  const [cashPreferenceSaved, setCashPreferenceSaved] = useState(false);
  const [cashPreferenceError, setCashPreferenceError] = useState<string | null>(null);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [editQuantities, setEditQuantities] = useState<Record<string, number>>({});
  const [isSavingOrderChange, setIsSavingOrderChange] = useState(false);
  useEffect(() => {
    if (order) {
      setPaymentAmount(String(Math.max(0, Number(order.remainingAmount ?? (order.totalAmount - Number(order.paidAmount || 0))))));
      setCashPreferenceSaved(order.paymentPreference === 'especes');
      setCashPreferenceError(null);
    }
  }, [order?.id, order?.remainingAmount, order?.paidAmount, order?.totalAmount, order?.paymentPreference]);
  useEffect(() => {
    if (!order || !customerAccessToken || !onCustomerOrderMutation || ['completed', 'cancelled'].includes(order.status)) return;
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || !active) return;
      inFlight = true;
      try {
        const result = await onCustomerOrderMutation({ action: 'get' });
        if (active && result.success && result.order) {
          // Parent owns the canonical order snapshot; the next render updates this panel.
        }
      } finally { inFlight = false; }
    };
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [order?.id, order?.status, customerAccessToken, onCustomerOrderMutation]);
  useEffect(() => {
    if (order) setEditQuantities(Object.fromEntries(order.items.map(item => [item.id, item.quantity])));
    setIsEditingOrder(false);
  }, [order?.id]);
  if (!order) return null;
  const remainingDue = Math.max(0, Number(order.remainingAmount ?? (order.totalAmount - Number(order.paidAmount || 0))));
  const requestedPaymentAmount = Number(paymentAmount);
  const validPaymentAmount = Number.isSafeInteger(requestedPaymentAmount) && requestedPaymentAmount > 0 && requestedPaymentAmount <= remainingDue;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-150">
      <div 
        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-auto animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-confirmed-title"
      >
        {/* Header Hero Banner with celebration */}
        <div className="relative bg-gradient-to-br from-[#101d2d] to-[#1a2e46] text-white p-6 text-center shrink-0">
          <button
            onClick={() => {
              sounds.playTap();
              onClose();
            }}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>

          <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mx-auto flex items-center justify-center mb-3 shadow-lg">
            <CheckCircle2 size={36} className="text-emerald-400" />
          </div>

          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 inline-block mb-1">
            Commande confirmée & transmise
          </span>

          <h2 id="order-confirmed-title" className="text-xl sm:text-2xl font-black tracking-tight text-white mt-1">
            {order.status === 'cancelled' ? 'Commande annulée' : order.status === 'completed' ? 'Commande servie' : order.status === 'ready' ? 'Commande prête' : order.status === 'in_prep' ? 'Votre commande est en préparation' : 'Commande confirmée'}
          </h2>

          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-white font-mono text-sm sm:text-base font-black">
            <span>Ticket n° :</span>
            <span className="text-amber-300 tracking-wider">{order.orderNumber}</span>
          </div>
        </div>

        {/* Order Details Body */}
        <div className="p-5 sm:p-6 space-y-5 flex-1 overflow-y-auto max-h-[60vh]">
          {/* Status and Location Badge */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Lieu du service
              </span>
              <div className="font-extrabold text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                {order.orderMode === 'sur_place' && order.tableNumber ? (
                  <>
                    <MapPin size={15} className="text-[#ff6500]" />
                    <span>Table {order.tableNumber}</span>
                  </>
                ) : (
                  <>
                    <ShoppingBag size={15} className="text-blue-600" />
                    <span>À emporter</span>
                  </>
                )}
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Statut actuel
              </span>
              <div className="font-extrabold text-xs sm:text-sm text-amber-700 flex items-center gap-1.5">
                <ChefHat size={15} className="text-amber-600" />
                <span>{order.status === 'pending' ? 'En attente' : order.status === 'in_prep' ? 'En préparation' : order.status === 'ready' ? 'Prête' : order.status === 'completed' ? 'Servie' : 'Annulée'}</span>
                {order.statusUpdatedAt && <span className="block text-[10px] font-semibold text-slate-500 mt-1">Mis à jour le {new Date(order.statusUpdatedAt).toLocaleString('fr-FR')}</span>}
              </div>
            </div>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Suivi de l’évolution de la commande" aria-live="polite">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-900">Suivi de votre commande</h3>
              <span className="text-[10px] font-semibold text-slate-500">Actualisation automatique</span>
            </div>
            {order.status === 'cancelled' ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <p className="font-black">Commande annulée</p>
                {order.cancellationReason && <p className="mt-1">Motif : {order.cancellationReason}</p>}
                {order.statusUpdatedAt && <p className="mt-1 text-[10px]">Le {new Date(order.statusUpdatedAt).toLocaleString('fr-FR')}</p>}
              </div>
            ) : (
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  { key: 'pending', label: 'Reçue' },
                  { key: 'in_prep', label: 'En préparation' },
                  { key: 'ready', label: 'Prête' },
                  { key: 'completed', label: 'Servie' }
                ] as const).map((step, index) => {
                  const orderStages = ['pending', 'in_prep', 'ready', 'completed'];
                  const currentIndex = orderStages.indexOf(order.status);
                  const reached = currentIndex >= index;
                  const current = order.status === step.key;
                  return (
                    <li key={step.key} className={`rounded-xl border p-2 text-center ${current ? 'border-orange-300 bg-orange-50 text-orange-900' : reached ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                      <span className="block text-[10px] font-black">{index + 1}. {step.label}</span>
                      <span className="mt-1 block text-[9px] font-semibold">{current ? 'Étape actuelle' : reached ? 'Validée' : 'À venir'}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="mt-3 text-[10px] text-slate-500">
              Commande créée le {new Date(order.createdAt).toLocaleString('fr-FR')}
              {order.statusUpdatedAt ? ` · Dernière évolution le ${new Date(order.statusUpdatedAt).toLocaleString('fr-FR')}` : ''}
            </p>
          </section>

          {/* Items Summary Table */}
          <div className="border border-slate-200/90 rounded-2xl p-4 space-y-3 bg-white shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                <Receipt size={14} className="text-slate-500" />
                <span>Récapitulatif des plats</span>
              </span>
              <span className="text-xs text-slate-500 font-bold">
                {order.itemsCount} article{order.itemsCount > 1 ? 's' : ''}
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {order.items.map((item, idx) => (
                <div key={item.id || idx} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-orange-100 text-[#ff6500] font-black text-[11px] flex items-center justify-center shrink-0 tnum">
                        {item.quantity}×
                      </span>
                      <span className="font-bold text-slate-900 leading-snug">
                        {item.name}
                      </span>
                    </div>

                    {item.selectedOption && (
                      <p className="text-[11px] text-slate-500 ml-7 mt-0.5">
                        ↳ {item.selectedOption.optionName}
                        {item.selectedOption.extraPrice > 0 && (
                          <span className="text-[#ff6500] font-bold ml-1">
                            (+{formatFCFA(item.selectedOption.extraPrice)})
                          </span>
                        )}
                      </p>
                    )}

                    {item.selectedExtras && item.selectedExtras.length > 0 && (
                      <p className="text-[10px] text-slate-400 ml-7 mt-0.5">
                        Extras : {item.selectedExtras.map(e => `${e.name} (+${formatFCFA(e.price)})`).join(', ')}
                      </p>
                    )}

                    {item.prepNotes && (
                      <p className="text-[10px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded ml-7 mt-1 inline-block">
                        Note : « {item.prepNotes} »
                      </p>
                    )}
                  </div>

                  <span className="font-extrabold text-slate-900 tnum whitespace-nowrap">
                    {formatFCFA(item.totalPrice)}
                  </span>
                </div>
              ))}
            </div>

            {/* Total Ledger */}
            <div className="pt-3 border-t border-slate-200 flex items-baseline justify-between">
              <div>
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Total Commande
                </span>
                <span className="text-[10px] text-slate-400">
                  Prix configurés par le restaurant · Mobile Money sur QR de table ou caisse
                </span>
              </div>
              <span className="text-lg sm:text-xl font-black text-[#ff6500] tnum">
                {formatFCFA(order.totalAmount)}
              </span>
            </div>
          </div>

          {order.status === 'pending' && Number(order.paidAmount || 0) === 0 && !['partial', 'paid'].includes(String(order.paymentStatus || '')) && customerAccessToken && onCustomerOrderMutation && (
            <section className="rounded-2xl border border-orange-200 bg-orange-50/60 p-4 space-y-3" aria-label="Gestion de votre commande">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-900">Gérer ma commande</h3>
                <p className="mt-1 text-[11px] text-slate-600">Vous pouvez encore modifier les quantités ou annuler tant que la préparation n’a pas commencé.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setIsEditingOrder(value => !value)}
                  className="rounded-xl border border-orange-300 bg-white px-3 py-2 text-xs font-bold text-orange-900">
                  {isEditingOrder ? 'Fermer la modification' : 'Modifier la commande'}
                </button>
                <button type="button" disabled={isSavingOrderChange}
                  onClick={async () => {
                    const reason = window.prompt('Pourquoi souhaitez-vous annuler cette commande ?');
                    if (reason === null) return;
                    if (reason.trim().length < 3) { window.alert('Veuillez indiquer un motif de 3 caractères minimum.'); return; }
                    if (!window.confirm('Confirmer l’annulation de cette commande ?')) return;
                    setIsSavingOrderChange(true);
                    try {
                      const result = await onCustomerOrderMutation({ action: 'cancel', reason: reason.trim() });
                      if (!result.success) window.alert(result.error || 'Annulation refusée.');
                    } finally { setIsSavingOrderChange(false); }
                  }}
                  className="rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">
                  Annuler la commande
                </button>
              </div>
              {isEditingOrder && (
                <div className="space-y-2">
                  {order.items.map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl border border-orange-100 bg-white p-2">
                      <span className="min-w-0 flex-1 text-xs font-bold text-slate-800">{item.name}</span>
                      <div className="flex items-center gap-2">
                        <button type="button" aria-label={`Diminuer ${item.name}`}
                          onClick={() => setEditQuantities(current => ({ ...current, [item.id]: Math.max(0, Number(current[item.id] ?? item.quantity) - 1) }))}
                          className="h-8 w-8 rounded-lg border border-slate-200 font-bold">−</button>
                        <span className="w-5 text-center text-xs font-black tabular-nums">{editQuantities[item.id] ?? item.quantity}</span>
                        <button type="button" aria-label={`Augmenter ${item.name}`}
                          onClick={() => setEditQuantities(current => ({ ...current, [item.id]: Math.min(50, Number(current[item.id] ?? item.quantity) + 1) }))}
                          className="h-8 w-8 rounded-lg border border-slate-200 font-bold">+</button>
                      </div>
                    </div>
                  ))}
                  <button type="button" disabled={isSavingOrderChange || !order.items.some(item => Number(editQuantities[item.id] ?? item.quantity) > 0)}
                    onClick={async () => {
                      const items = order.items.map(item => ({ id: item.id, quantity: Number(editQuantities[item.id] ?? item.quantity), prepNotes: item.prepNotes })).filter(item => item.quantity > 0);
                      setIsSavingOrderChange(true);
                      try {
                        const result = await onCustomerOrderMutation({ action: 'edit', items });
                        if (!result.success) window.alert(result.error || 'Modification refusée.');
                        else setIsEditingOrder(false);
                      } finally { setIsSavingOrderChange(false); }
                    }}
                    className="w-full rounded-xl bg-[#101d2d] px-4 py-3 text-xs font-black text-white disabled:opacity-50">
                    {isSavingOrderChange ? 'Enregistrement…' : 'Enregistrer les modifications'}
                  </button>
                </div>
              )}
            </section>
          )}

          {order.orderMode === 'sur_place' && onStartPayDunyaPayment && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 space-y-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wide text-blue-950">Régler maintenant par Mobile Money</h3>
                <p className="mt-1 text-[10px] text-blue-900">Choisissez votre opérateur. Le paiement sera confirmé par PayDunya avant toute mise à jour du reçu.</p>
              </div>
              <label className="block text-[11px] font-bold text-blue-950">
                Montant à régler maintenant (FCFA)
                <input type="number" min="1" max={remainingDue} step="1" value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)} disabled={isStartingPayment}
                  className="mt-1 w-full rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900" />
              </label>
              <p className="text-[10px] text-blue-900">Vous pouvez payer une partie ou la totalité du solde restant : {formatFCFA(remainingDue)}.</p>
              <select value={selectedChannel} onChange={(event) => setSelectedChannel(event.target.value as typeof selectedChannel)}
                disabled={isStartingPayment}
                className="w-full rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-800">
                <option value="wave-ci">Wave</option>
                <option value="orange-money-ci">Orange Money</option>
                <option value="mtn-ci">MTN MoMo</option>
                <option value="moov-ci">Moov Money</option>
                <option value="djamo-ci">Djamo</option>
              </select>
              <button type="button" disabled={isStartingPayment || !validPaymentAmount || !onStartPayDunyaPayment || cashPreferenceSaved}
                onClick={async () => {
                  if (!validPaymentAmount) return;
                  setIsStartingPayment(true);
                  try { await onStartPayDunyaPayment(order, selectedChannel, requestedPaymentAmount); }
                  finally { setIsStartingPayment(false); }
                }}
                className="w-full rounded-xl bg-[#101d2d] px-4 py-3 text-xs font-black text-white disabled:opacity-50">
                {isStartingPayment ? 'Préparation du paiement…' : `Payer ${formatFCFA(requestedPaymentAmount)} avec PayDunya`}
              </button>
            </div>
          )}

          {order.orderMode === 'sur_place' && onSelectCashPayment && remainingDue > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-3">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wide text-emerald-950">Régler en espèces</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-emerald-900">
                  Vous pouvez régler directement auprès du serveur ou du caissier. Ce règlement est enregistré dans la caisse RestauMax après réception effective des espèces. Il ne passe jamais par PayDunya.
                </p>
              </div>
              {cashPreferenceSaved ? (
                <div role="status" className="rounded-xl border border-emerald-300 bg-white p-3 text-xs font-bold text-emerald-900">
                  <CheckCircle2 size={15} className="inline mr-1.5" />
                  Choix espèces enregistré. Solde à régler au personnel : {formatFCFA(remainingDue)}.
                </div>
              ) : (
                <button type="button" disabled={isSelectingCash || isStartingPayment}
                  onClick={async () => {
                    setIsSelectingCash(true);
                    setCashPreferenceError(null);
                    try {
                      const result = await onSelectCashPayment(order);
                      if (result.success) setCashPreferenceSaved(true);
                      else setCashPreferenceError(result.error || 'Le choix espèces n’a pas pu être enregistré.');
                    } catch (error: any) {
                      setCashPreferenceError(error?.message || 'Erreur réseau lors du choix espèces.');
                    } finally {
                      setIsSelectingCash(false);
                    }
                  }}
                  className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-xs font-black text-white disabled:opacity-50">
                  {isSelectingCash ? 'Enregistrement du choix…' : 'Choisir le règlement en espèces'}
                </button>
              )}
              {cashPreferenceError && <p role="alert" className="text-[11px] font-semibold text-rose-700">{cashPreferenceError}</p>}
            </div>
          )}

          {/* Info callout */}
          {order.status !== 'cancelled' && order.status !== 'completed' && <div className="p-3.5 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-2.5">
            <Sparkles size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-bold text-emerald-900">Préparation en cours :</span> L'équipe de {restaurantName} a reçu votre ticket. Installez-vous confortablement, le service sera assuré dès que vos plats seront prêts.
            </div>
          </div>}
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              sounds.playTap();
              onNewOrder();
            }}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all active:scale-95"
          >
            Passer une autre commande
          </button>

          <button
            type="button"
            onClick={() => {
              sounds.playTap();
              onClose();
            }}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#ff6500] hover:bg-[#e05800] text-white text-xs font-black shadow-md transition-all flex items-center justify-center gap-1.5 active:scale-95"
          >
            <span>Retour au menu</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
