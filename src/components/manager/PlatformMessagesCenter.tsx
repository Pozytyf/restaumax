import React, { useCallback, useEffect, useState } from 'react';
import { auth } from '../../lib/firebase';

type Message = { id: string; body: string; authorRole: string; visibility: string; createdAt: number };
type Ticket = {
  id: string; subject: string; status: string; priority: string;
  createdAt: number; updatedAt: number; messages: Message[];
};
type Announcement = { id: string; title: string; message: string; publishedAt: number; targetType: string };

const inputClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

export const PlatformMessagesCenter: React.FC<{ restaurantSlug: string }> = ({ restaurantSlug }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('medium');
  const [reply, setReply] = useState('');
  const [selectedTicket, setSelectedTicket] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const call = useCallback(async (action: string, body?: Record<string, unknown>) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Votre session a expiré. Reconnectez-vous.');
    const token = await user.getIdToken(true);
    const response = await fetch('/api/platform-admin' + (body ? '' : '?' + new URLSearchParams({ action })), {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      credentials: 'same-origin', cache: 'no-store',
      body: body ? JSON.stringify({ ...body, action }) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Service momentanément indisponible.');
    return data;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [ticketData, announcementData] = await Promise.all([
        call('support_my_tickets'), call('restaurant_announcements')
      ]);
      setTickets(ticketData.tickets || []);
      setAnnouncements(announcementData.announcements || []);
    } catch (e: any) { setError(e.message || 'Chargement impossible.'); }
    finally { setLoading(false); }
  }, [call]);

  useEffect(() => { void refresh(); }, [refresh, restaurantSlug]);

  const submitTicket = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(''); setNotice('');
    try {
      await call('support_submit', { subject, message, priority });
      setSubject(''); setMessage(''); setPriority('medium');
      setNotice('Votre demande a été transmise à l’équipe RestauMax.');
      await refresh();
    } catch (e: any) { setError(e.message || 'Envoi impossible.'); }
    finally { setLoading(false); }
  };

  const submitReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTicket || !reply.trim()) return;
    setLoading(true); setError(''); setNotice('');
    try {
      await call('support_reply', { ticketId: selectedTicket, message: reply.trim() });
      setReply(''); setNotice('Votre réponse a été ajoutée au ticket.');
      await refresh();
    } catch (e: any) { setError(e.message || 'Réponse impossible.'); }
    finally { setLoading(false); }
  };

  return <section className="space-y-4" aria-label="Messages et assistance RestauMax">
    {announcements.map(item => <article key={item.id} className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-[#102a43]">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-blue-800">Information RestauMax</div>
      <h2 className="font-extrabold">{item.title}</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm">{item.message}</p>
      <p className="mt-2 text-xs text-blue-800">{item.publishedAt ? new Date(item.publishedAt).toLocaleString('fr-FR') : ''}</p>
    </article>)}
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-extrabold text-[#101d2d]">Contacter l’assistance</h2>
        <p className="mt-1 text-xs text-slate-500">Décrivez le problème sans inclure de mot de passe ni de donnée bancaire.</p>
        <form onSubmit={submitTicket} className="mt-3 space-y-3">
          <label className="block text-sm font-semibold text-slate-700">Sujet
            <input required minLength={5} maxLength={140} value={subject} onChange={e=>setSubject(e.target.value)} className={inputClass}/>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Priorité
            <select value={priority} onChange={e=>setPriority(e.target.value)} className={inputClass}><option value="low">Faible</option><option value="medium">Moyenne</option><option value="high">Élevée</option></select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Description
            <textarea required minLength={10} maxLength={4000} rows={4} value={message} onChange={e=>setMessage(e.target.value)} className={inputClass}/>
          </label>
          <button disabled={loading} className="min-h-11 rounded-xl bg-[#101d2d] px-4 text-sm font-bold text-white">{loading?'Envoi…':'Envoyer la demande'}</button>
        </form>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2"><h2 className="font-extrabold text-[#101d2d]">Suivi de mes demandes</h2><button type="button" onClick={()=>void refresh()} className="min-h-11 rounded-lg border px-3 text-xs font-bold">Actualiser</button></div>
        {tickets.length===0?<p className="py-6 text-sm text-slate-500">{loading?'Chargement…':'Aucun ticket pour ce restaurant.'}</p>:<div className="mt-3 space-y-2">{tickets.map(ticket=><div key={ticket.id} className="rounded-xl border border-slate-200 p-3">
          <button type="button" onClick={()=>setSelectedTicket(selectedTicket===ticket.id?'':ticket.id)} className="flex min-h-11 w-full items-center justify-between gap-2 text-left"><span><span className="block font-bold">{ticket.subject}</span><span className="block text-xs text-slate-500">{ticket.id} · {ticket.status} · {ticket.priority}</span></span><span className="text-xs font-bold text-[#9a3412]">{selectedTicket===ticket.id?'Masquer':'Voir'}</span></button>
          {selectedTicket===ticket.id&&<div className="mt-3 space-y-2 border-t border-slate-100 pt-3">{ticket.messages.map(msg=><div key={msg.id} className="rounded-lg bg-slate-50 p-3"><p className="mb-1 text-xs text-slate-500">{msg.authorRole==='platform_admin'?'Équipe RestauMax':'Votre équipe'} · {new Date(msg.createdAt).toLocaleString('fr-FR')}</p><p className="whitespace-pre-wrap text-sm">{msg.body}</p></div>)}{!['closed'].includes(ticket.status)&&<form onSubmit={submitReply} className="space-y-2"><label className="block text-sm font-semibold text-slate-700">Répondre
            <textarea required minLength={2} maxLength={4000} rows={2} value={reply} onChange={e=>setReply(e.target.value)} className={inputClass}/>
          </label><button disabled={loading} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold">Ajouter une réponse</button></form>}</div>}
        </div>)}</div>}
      </section>
    </div>
    {error&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
    {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
  </section>;
};
