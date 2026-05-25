import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { query } from './orchestrator.js';
import { getInitialScenario, getInitialChatMessage } from './mocks/pubchem.js';

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── SSE log broadcast ─────────────────────────────────────────
const logClients = new Set();
const HEARTBEAT_MS = 25 * 1000; // nginx 기본 60초보다 충분히 짧게

// 원본 console — 오버라이드 내부에서 사용해야 안전 (재귀 방지)
const _log   = console.log.bind(console);
const _warn  = console.warn.bind(console);
const _error = console.error.bind(console);

function broadcastLog(level, args) {
  if (!logClients.size) return;
  let data;
  try {
    const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    data = JSON.stringify({ level, text, ts: Date.now() });
  } catch (e) {
    // JSON.stringify 실패(circular 등) — 원본 console로만 출력
    _error('[broadcastLog] serialize failed:', e.message);
    return;
  }

  // 한 클라이언트의 write 실패가 다른 클라이언트에 영향을 주지 않도록 개별 try/catch
  for (const res of logClients) {
    try {
      res.write(`event: log\ndata: ${data}\n\n`);
    } catch (e) {
      _error('[broadcastLog] client write failed:', e.message);
      logClients.delete(res);
    }
  }
}

// console 오버라이드 — broadcastLog 내부 예외가 console.* 호출하면 무한 루프 위험이 있으므로
// broadcastLog는 _error만 호출하도록 위에서 보장
console.log   = (...a) => { _log(...a);   broadcastLog('info',  a); };
console.warn  = (...a) => { _warn(...a);  broadcastLog('warn',  a); };
console.error = (...a) => { _error(...a); broadcastLog('error', a); };

app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  logClients.add(res);

  // SSE heartbeat — 프록시 idle timeout 방지
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // write 실패 시 cleanup
      cleanup();
    }
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    logClients.delete(res);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
});

// ── Routes ────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/init', (_req, res) => {
  res.json({
    scenario: getInitialScenario(),
    chatMessage: getInitialChatMessage(),
  });
});

// /api/query — SSE 스트리밍 응답
app.post('/api/query', async (req, res) => {
  const { userMessage, sessionId, currentMoleculeContext } = req.body;

  if (!userMessage || !sessionId) {
    return res.status(400).json({ error: 'userMessage and sessionId are required' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      _error('[query SSE] write failed:', e.message);
    }
  };

  // SSE heartbeat — 길어지는 LLM 응답 중 nginx/프록시 idle timeout 방지
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, HEARTBEAT_MS);

  const runQuery = () => query(
    userMessage, sessionId, currentMoleculeContext,
    (event, data) => send('progress', { event, ...data }),
  );

  try {
    const result = await runQuery();
    // scenario null이면 1회 재시도 (LLM이 <scenario> 태그를 생략한 경우)
    if (!result.scenario) {
      console.warn('scenario null — 1회 재시도');
      await new Promise(r => setTimeout(r, 1000));
      const retry = await runQuery();
      send('done', retry);
    } else {
      send('done', result);
    }
  } catch (err) {
    console.warn(`Query error (1차): ${err.message} — 2초 후 재시도`);
    await new Promise(r => setTimeout(r, 2000));
    try {
      const result = await runQuery();
      send('done', result);
    } catch (err2) {
      console.error('Query error (2차):', err2.message);
      send('error', { message: '분석 중 오류가 발생했습니다. 다시 시도해주세요.' });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`ChemCanvas server running on port ${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn('WARNING: GEMINI_API_KEY not set.');
  } else {
    console.log(`Using model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-14'}`);
  }
});
