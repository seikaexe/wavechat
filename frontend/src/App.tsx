import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const GID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const tok = () => localStorage.getItem('wc_token') || '';
async function api(path: string, method = 'GET', body?: any) {
  const r = await fetch(API + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok() }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Terjadi kesalahan');
  return d;
}

function Login({ onDone }: { onDone: (u: any) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setInterval(() => {
      const g = (window as any).google;
      if (!g) return;
      clearInterval(t);
      g.accounts.id.initialize({ client_id: GID, callback: async (r: any) => {
        try { const d = await api('/auth/google', 'POST', { credential: r.credential }); localStorage.setItem('wc_token', d.token); onDone(d.user); }
        catch (e: any) { setErr(e.message); }
      } });
      g.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large' });
    }, 200);
    return () => clearInterval(t);
  }, []);
  return <div className="center"><div className="card"><h1>🌊 Wavechat</h1><p>Masuk dengan akun Google untuk mulai ngobrol.</p><div ref={ref} />{err && <b>{err}</b>}</div></div>;
}

function Onboarding({ onDone }: { onDone: (u: any) => void }) {
  const [nickname, setN] = useState(''); const [username, setU] = useState(''); const [err, setErr] = useState('');
  const go = async () => { try { onDone(await api('/me/onboarding', 'POST', { nickname, username })); } catch (e: any) { setErr(e.message); } };
  return <div className="center"><div className="card"><h2>Lengkapi profil</h2>
    <input placeholder="Nickname" value={nickname} onChange={e => setN(e.target.value)} />
    <input placeholder="username_unik" value={username} onChange={e => setU(e.target.value.toLowerCase())} />
    {err && <b>{err}</b>}<button onClick={go}>Simpan</button></div></div>;
}

function Chat({ me, onLogout }: { me: any; onLogout: () => void }) {
  const [convs, setConvs] = useState<any[]>([]); const [active, setActive] = useState<any>(null);
  const [msgs, setMsgs] = useState<any[]>([]); const [text, setText] = useState(''); const [q, setQ] = useState('');
  const [found, setFound] = useState<any[]>([]); const [onl, setOnl] = useState<Set<string>>(new Set()); const [typing, setTyping] = useState('');
  const sock = useRef<Socket>(); const activeRef = useRef<any>(null); const end = useRef<HTMLDivElement>(null);
  activeRef.current = active;
  const load = () => api('/conversations').then(setConvs);
  useEffect(() => {
    load();
    const s = io(API, { auth: { token: tok() } }); sock.current = s;
    s.on('presence:list', (l: string[]) => setOnl(new Set(l)));
    s.on('presence:update', ({ userId, online }: any) => setOnl(p => { const n = new Set(p); online ? n.add(userId) : n.delete(userId); return n; }));
    s.on('message:new', (m: any) => {
      if (activeRef.current?.id === m.conversation_id) { setMsgs(p => [...p, m]); if (m.sender_id !== me.id) s.emit('message:read', { conversationId: m.conversation_id }); }
      load();
    });
    s.on('message:read', ({ conversationId }: any) => { if (activeRef.current?.id === conversationId) setMsgs(p => p.map(m => m.read_at ? m : { ...m, read_at: new Date().toISOString() })); load(); });
    s.on('typing', ({ conversationId }: any) => { if (activeRef.current?.id === conversationId) { setTyping('mengetik…'); setTimeout(() => setTyping(''), 1500); } });
    return () => { s.close(); };
  }, []);
  useEffect(() => { end.current?.scrollIntoView(); }, [msgs]);
  useEffect(() => { const t = setTimeout(() => q.length > 1 ? api('/users/search?q=' + encodeURIComponent(q)).then(setFound) : setFound([]), 250); return () => clearTimeout(t); }, [q]);
  const open = async (c: any) => { setActive(c); setMsgs(await api(`/conversations/${c.id}/messages`)); sock.current?.emit('message:read', { conversationId: c.id }); };
  const start = async (u: any) => { const { id } = await api('/conversations', 'POST', { userId: u.id }); setQ(''); await load(); open({ id, user_id: u.id, nickname: u.nickname, username: u.username }); };
  const send = () => { if (!text.trim() || !active) return; sock.current?.emit('message:send', { conversationId: active.id, body: text }); setText(''); };
  return <div className={'app' + (active ? ' open' : '')}>
    <div className="side"><b>{me.nickname} (@{me.username})</b>
      <input placeholder="Cari @username…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="list">
        {found.map(u => <button key={u.id} className="row" onClick={() => start(u)}>➕ {u.nickname} @{u.username}</button>)}
        {convs.map(c => <button key={c.id} className={'row' + (active?.id === c.id ? ' on' : '')} onClick={() => open(c)}>
          {onl.has(c.user_id) && <span className="dot">● </span>}<b>{c.nickname}</b> {c.unread > 0 && `(${c.unread})`}<br /><small>{c.last_body}</small></button>)}
      </div><button onClick={onLogout}>Keluar</button></div>
    {active ? <div className="chat"><div className="head"><button onClick={() => setActive(null)}>←</button> {active.nickname} {typing && <small>{typing}</small>}</div>
      <div className="msgs">{msgs.map(m => <div key={m.id} className={'m' + (m.sender_id === me.id ? ' me' : '')}>{m.body}{m.sender_id === me.id && <small> {m.read_at ? '✓✓' : '✓'}</small>}</div>)}<div ref={end} /></div>
      <div className="bar"><input value={text} placeholder="Tulis pesan" onChange={e => { setText(e.target.value); sock.current?.emit('typing', { conversationId: active.id }); }} onKeyDown={e => e.key === 'Enter' && send()} /><button onClick={send}>Kirim</button></div></div>
      : <div className="center"><p>Pilih percakapan atau cari username.</p></div>}
  </div>;
}

export default function App() {
  const [me, setMe] = useState<any>(null); const [ready, setReady] = useState(false);
  useEffect(() => { (tok() ? api('/me').then(setMe).catch(() => localStorage.removeItem('wc_token')) : Promise.resolve()).finally(() => setReady(true)); }, []);
  if (!ready) return null;
  if (!me) return <Login onDone={setMe} />;
  if (!me.username) return <Onboarding onDone={setMe} />;
  return <Chat me={me} onLogout={() => { localStorage.removeItem('wc_token'); setMe(null); }} />;
}
