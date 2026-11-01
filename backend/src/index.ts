import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { Server } from 'socket.io';
import { Pool } from 'pg';

const { DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_ID, CLIENT_ORIGIN = 'http://localhost:5173', PORT = '4000' } = process.env;
if (!DATABASE_URL || !JWT_SECRET || !GOOGLE_CLIENT_ID) throw new Error('Isi DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_ID di backend/.env');
const db = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('supabase') ? { rejectUnauthorized: false } : undefined });
const google = new OAuth2Client(GOOGLE_CLIENT_ID);
const app = express();
app.use(helmet(), cors({ origin: CLIENT_ORIGIN }), express.json({ limit: '100kb' }), rateLimit({ windowMs: 60000, limit: 200 }));
const sign = (id: string) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' });
const verify = (t: string): string | null => { try { return (jwt.verify(t, JWT_SECRET) as any).id; } catch { return null; } };
const wrap = (f: any) => (req: any, res: any) => f(req, res).catch((e: any) => { console.error(e); res.status(500).json({ error: 'Kesalahan server' }); });
const auth = (req: any, res: any, next: any) => {
  const id = verify((req.headers.authorization || '').replace('Bearer ', ''));
  if (!id) return res.status(401).json({ error: 'Belum login' });
  req.uid = id; next();
};

app.post('/api/auth/google', wrap(async (req: any, res: any) => {
  const t = await google.verifyIdToken({ idToken: String(req.body.credential), audience: GOOGLE_CLIENT_ID }).catch(() => null);
  const p = t?.getPayload();
  if (!p?.sub || !p.email_verified) return res.status(401).json({ error: 'Token Google tidak valid' });
  const { rows } = await db.query(
    `INSERT INTO users(google_id,email,avatar_url) VALUES($1,$2,$3)
     ON CONFLICT(google_id) DO UPDATE SET email=EXCLUDED.email, avatar_url=EXCLUDED.avatar_url RETURNING *`, [p.sub, p.email, p.picture || null]);
  res.json({ token: sign(rows[0].id), user: rows[0] });
}));
app.get('/api/me', auth, wrap(async (req: any, res: any) => {
  const { rows } = await db.query('SELECT * FROM users WHERE id=$1', [req.uid]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Tidak ditemukan' });
}));
app.post('/api/me/onboarding', auth, wrap(async (req: any, res: any) => {
  const nickname = String(req.body.nickname || '').trim().slice(0, 40);
  const username = String(req.body.username || '').toLowerCase();
  if (!nickname || !/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Nickname wajib; username 3-20 karakter a-z, 0-9, _' });
  try {
    const { rows } = await db.query('UPDATE users SET nickname=$1, username=$2 WHERE id=$3 RETURNING *', [nickname, username, req.uid]);
    res.json(rows[0]);
  } catch (e: any) { e.code === '23505' ? res.status(409).json({ error: 'Username sudah dipakai' }) : (() => { throw e; })(); }
}));
app.get('/api/users/search', auth, wrap(async (req: any, res: any) => {
  const q = String(req.query.q || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (q.length < 2) return res.json([]);
  const { rows } = await db.query('SELECT id,nickname,username,avatar_url FROM users WHERE username LIKE $1 AND id<>$2 LIMIT 10', [q + '%', req.uid]);
  res.json(rows);
}));
app.post('/api/conversations', auth, wrap(async (req: any, res: any) => {
  const other = String(req.body.userId);
  const ok = other !== req.uid && (await db.query('SELECT 1 FROM users WHERE id=$1 AND username IS NOT NULL', [other]).catch(() => ({ rowCount: 0 }))).rowCount;
  if (!ok) return res.status(400).json({ error: 'Pengguna tidak valid' });
  const [a, b] = [req.uid, other].sort();
  const { rows } = await db.query('INSERT INTO conversations(user_a,user_b) VALUES($1,$2) ON CONFLICT(user_a,user_b) DO UPDATE SET user_a=EXCLUDED.user_a RETURNING id', [a, b]);
  res.json(rows[0]);
}));
app.get('/api/conversations', auth, wrap(async (req: any, res: any) => {
  const { rows } = await db.query(
    `SELECT c.id, u.id AS user_id, u.nickname, u.username, u.avatar_url,
      (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_body,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id AND m.sender_id<>$1 AND m.read_at IS NULL) AS unread
     FROM conversations c JOIN users u ON u.id = CASE WHEN c.user_a=$1 THEN c.user_b ELSE c.user_a END
     WHERE c.user_a=$1 OR c.user_b=$1 ORDER BY (SELECT max(created_at) FROM messages m WHERE m.conversation_id=c.id) DESC NULLS LAST`, [req.uid]);
  res.json(rows);
}));
const member = async (cid: string, uid: string) =>
  (await db.query('SELECT user_a,user_b FROM conversations WHERE id=$1 AND (user_a=$2 OR user_b=$2)', [cid, uid])).rows[0];
app.get('/api/conversations/:id/messages', auth, wrap(async (req: any, res: any) => {
  if (!(await member(req.params.id, req.uid).catch(() => null))) return res.status(403).json({ error: 'Dilarang' });
  const { rows } = await db.query('SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at LIMIT 500', [req.params.id]);
  res.json(rows);
}));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });
const online = new Map<string, number>();
io.use((s, next) => { const id = verify(String(s.handshake.auth?.token)); id ? ((s.data.uid = id), next()) : next(new Error('unauthorized')); });
io.on('connection', (s) => {
  const uid = s.data.uid as string;
  s.join('user:' + uid);
  online.set(uid, (online.get(uid) || 0) + 1);
  s.emit('presence:list', [...online.keys()]);
  io.emit('presence:update', { userId: uid, online: true });
  s.on('message:send', async ({ conversationId, body }, ack) => {
    try {
      const c = await member(conversationId, uid);
      const text = String(body || '').trim();
      if (!c || !text || text.length > 4000) return ack?.({ error: 'Pesan ditolak' });
      const { rows } = await db.query('INSERT INTO messages(conversation_id,sender_id,body) VALUES($1,$2,$3) RETURNING *', [conversationId, uid, text]);
      io.to('user:' + c.user_a).to('user:' + c.user_b).emit('message:new', rows[0]);
      ack?.({ ok: true });
    } catch { ack?.({ error: 'Gagal mengirim' }); }
  });
  s.on('typing', async ({ conversationId }) => {
    const c = await member(conversationId, uid).catch(() => null);
    if (c) io.to('user:' + (c.user_a === uid ? c.user_b : c.user_a)).emit('typing', { conversationId, userId: uid });
  });
  s.on('message:read', async ({ conversationId }) => {
    const c = await member(conversationId, uid).catch(() => null);
    if (!c) return;
    await db.query('UPDATE messages SET read_at=now() WHERE conversation_id=$1 AND sender_id<>$2 AND read_at IS NULL', [conversationId, uid]);
    io.to('user:' + c.user_a).to('user:' + c.user_b).emit('message:read', { conversationId, readerId: uid });
  });
  s.on('disconnect', () => {
    const n = (online.get(uid) || 1) - 1;
    if (n <= 0) { online.delete(uid); io.emit('presence:update', { userId: uid, online: false }); } else online.set(uid, n);
  });
});
server.listen(Number(PORT), () => console.log('Wavechat API :' + PORT));
