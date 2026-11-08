/* ════════════════════════════════════════════════════════════
   서비스 워커 — 앱을 휴대폰 안에 담아두는 부품

   이게 있어야 통신이 없는 곳에서도 앱이 켜집니다.
   앱과 인터넷 사이에 앉아 있는 중개인이라고 보시면 됩니다.

     앱   : "점검 화면 줘"
     여기 : "내가 갖고 있어. 여기."      ← 인터넷을 안 거칩니다
     앱   : 화면 표시

   ⚠️ 이 파일은 【재료】입니다. 빌드하면 배포용/sw.js 로 복사되면서
      아래 dc5aed30 자리에 빌드 시각이 찍힙니다.
      배포용/sw.js 를 직접 고치지 마세요.
   ════════════════════════════════════════════════════════════ */

const VERSION = 'dc5aed30';
const CACHE   = 'sky-insp-' + VERSION;

/* 휴대폰에 미리 담아둘 파일들 — 이것만 있으면 앱이 켜집니다 */
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/* ── 설치 : 파일을 담아둡니다 ──────────────────────────────── */
/* 앱이 켜지는 데 반드시 필요한 것 — 하나라도 못 받으면 설치를 실패시킵니다 */
const SHELL_REQUIRED = ['./', './index.html', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    /* ⚠️ 2026-09-05 (A-4) — 예전에는 전부 개별 try/catch 로 담고 무조건 skipWaiting 했습니다.
         신호가 약한 곳에서 sw.js(5KB)만 받고 index.html(208KB)을 못 받으면
         빈 캐시로 새 버전이 활성화되고 → 아래 activate 가 멀쩡한 옛 캐시를 지워
         【다음 오프라인 기동이 흰 화면】 이 됐습니다.
         이제 필수 3개는 하나라도 실패하면 throw → 설치 실패 → 옛 버전이 그대로 남습니다.
         (브라우저가 나중에 다시 시도합니다) */
    for (const url of SHELL_REQUIRED) {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res || !res.ok) throw new Error('[sw] 필수 파일 실패: ' + url + ' ' + (res && res.status));
      await cache.put(url, res);
    }

    /* 아이콘은 없어도 앱은 켜집니다 — 실패해도 넘어갑니다 */
    await Promise.all(SHELL.filter(u => SHELL_REQUIRED.indexOf(u) < 0).map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[sw] 담지 못함(선택)', url, e.message); }
    }));

    /* 새 버전을 곧바로 쓰게 합니다.
       이 앱은 화면이 파일 하나라서 「반은 옛것 반은 새것」이 될 일이 없습니다. */
    await self.skipWaiting();
  })());
});

/* ── 활성화 : 옛 버전 짐을 버립니다 ────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n.startsWith('sky-insp-') && n !== CACHE)
           .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* ── 요청 가로채기 ─────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const req = event.request;

  /* ① 서버로 보내는 데이터 요청(POST)은 절대 건드리지 않습니다.
        점검 제출·사진 업로드가 여기 해당합니다.
        캐시했다가는 옛 응답을 돌려주는 大형 사고가 납니다. */
  if (req.method !== 'GET') return;

  /* ② 다른 집 주소(script.google.com 등)도 건드리지 않습니다.
        앱이 스스로 시간제한·오프라인 처리를 하고 있습니다. */
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* ③ 우리 집 파일 — 담아둔 것을 먼저 줍니다 (이게 오프라인 실행의 핵심) */
  event.respondWith((async () => {
    const cache  = await caches.open(CACHE);
    /* 2026-09-05 (A-15) — 저장 키에서 ?token= 같은 쿼리를 뗍니다.
       예전에는 req 그대로 put 해서 Cache Storage 에 토큰이 박힌 주소가 쌓였습니다. */
    const key    = url.pathname;
    const cached = await cache.match(key) || await cache.match(req, { ignoreSearch: true });

    if (cached) {
      /* 담아둔 것을 바로 주고, 뒤에서 조용히 새것을 받아둡니다.
         다음에 켤 때 새 화면이 나옵니다. */
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) await cache.put(key, fresh.clone());
        } catch (_) { /* 통신이 없으면 그냥 넘어갑니다 — 정상입니다 */ }
      })());
      return cached;
    }

    /* 담아둔 게 없으면 인터넷에서 받아 담아둡니다 */
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) await cache.put(key, fresh.clone());
      return fresh;
    } catch (e) {
      /* 통신도 없고 담아둔 것도 없을 때 —
         화면 이동 요청이면 시작 화면이라도 돌려줍니다 */
      if (req.mode === 'navigate') {
        const home = await cache.match('./index.html');
        if (home) return home;
      }
      throw e;
    }
  })());
});

/* ════════════════════════════════════════════════════════════
   ── 뒤에서 보내기 (Background Sync) · 2026-11-05 ────────────

   【무엇을 고치나】
     예전에는 제출 뒤 전송이 「화면의 자바스크립트」로 돌았습니다.
     점검원이 화면을 끄거나 앱을 닫으면 그 자리에서 멈췄습니다.
     이제 서비스워커가 이어받아, 앱이 닫혀 있어도 보냅니다.

   ⚠️ 【안드로이드만 됩니다.】 iOS 는 Background Sync 가 없습니다.
      아이폰은 화면이 켜져 있는 동안 보내도록 앱 쪽에서 따로 잡아 둡니다(화면 꺼짐 방지).
      그래서 이 파일이 없어도 앱은 예전과 똑같이 동작합니다 — 더해지는 기능입니다.

   ⚠️ 【두 번 보내도 안전합니다.】
      화면과 서비스워커가 같은 건을 동시에 보낼 수 있습니다. 서버가 막습니다.
        점검 : 제출키(data.제출키) 로 같은 점검을 두 번 안 받습니다
        사진 : 점검ID + 원본 파일명 으로 같은 사진을 두 번 안 만듭니다
      그래서 「겹치면 어쩌나」 를 여기서 따로 막지 않습니다.
   ════════════════════════════════════════════════════════════ */

const API_URL   = 'https://script.google.com/macros/s/AKfycbykuZDhMNZ_IRjpJ6M712nNMPx4_uV_ky5o8ZOwlf5WhU38hRMI4zy47O5pFYlklKefWQ/exec';          /* 빌드할 때 실제 주소가 박힙니다 */
const IDB_NAME  = 'SolarInspDB';
const IDB_VER   = 3;
const IDB_SUBMIT= 'submitQ';
const 사진묶음  = 8;                       /* 서버 PHOTO_FLUSH_MAX 와 같은 값 */
const 동기이름  = 'flush-submits';

function db열기_() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    /* ⚠️ 여기서 onupgradeneeded 를 쓰지 않습니다.
          스토어를 만드는 쪽은 앱 하나뿐이어야 합니다. 서비스워커가 먼저 열어
          빈 스토어를 만들면, 앱이 기대하는 모양과 어긋날 수 있습니다. */
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function 큐읽기_(db) {
  return new Promise(res => {
    try {
      const r = db.transaction(IDB_SUBMIT, 'readonly').objectStore(IDB_SUBMIT).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror   = () => res([]);
    } catch (_) { res([]); }
  });
}
function 큐쓰기_(db, item) {
  return new Promise(res => {
    try {
      const tx = db.transaction(IDB_SUBMIT, 'readwrite');
      tx.objectStore(IDB_SUBMIT).put(item);
      tx.oncomplete = res; tx.onerror = res;
    } catch (_) { res(); }
  });
}
function 큐지우기_(db, id) {
  return new Promise(res => {
    try {
      const tx = db.transaction(IDB_SUBMIT, 'readwrite');
      tx.objectStore(IDB_SUBMIT).delete(id);
      tx.oncomplete = res; tx.onerror = res;
    } catch (_) { res(); }
  });
}

/** 서버에 한 번 물어봅니다. 토큰은 큐에 담아 둔 것을 씁니다 (서비스워커는 localStorage 를 못 봅니다) */
async function 보내기_(action, params, token, 제한) {
  const body = Object.assign({ action: action }, params);
  if (token) body.token = token;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 제한 || 90000);
  try {
    const res  = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: ac.signal
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch (_) { return null; }
  } catch (e) {
    return null;
  } finally { clearTimeout(t); }
}

/**
 * 대기함을 비웁니다 — 화면의 autoFlushSubmits() 와 같은 순서입니다
 *   ① 점검 기록 (이미 보냈으면 건너뜀)  ② 사진 8장씩  ③ 다 되면 큐에서 지움
 * @return {{보냄:number, 남음:number}}
 */
async function 대기함비우기_() {
  let db;
  try { db = await db열기_(); } catch (_) { return { 보냄: 0, 남음: 0 }; }

  const items = await 큐읽기_(db);
  let 보냄 = 0, 남음 = 0;

  for (const item of items) {
    try {
      const p = item.payload || {};
      const token = item.token || p.token || '';

      /* ① 점검 기록 — submittedId 가 있으면 이미 보낸 것입니다 */
      let inspId = p.submittedId || '';
      if (!inspId) {
        const r = await 보내기_('submitInspection', { ...(p.data || {}) }, token, 60000);
        if (!r || !r.success) { 남음++; continue; }
        inspId = r.inspId;
        p.submittedId = inspId;
        item.payload = p;
        await 큐쓰기_(db, item);        /* 성공을 먼저 적어 둡니다 — 두 번 안 보내게 */
      }

      /* ② 사진 — 8장씩, 실패한 것만 남깁니다 */
      const photos = p.photos || [];
      const remain = [];
      for (let i = 0; i < photos.length; i += 사진묶음) {
        const 이번 = photos.slice(i, i + 사진묶음);
        이번.forEach(ph => { ph.inspId = inspId; });
        const pr = await 보내기_('flushPhotoQueue', { queue: 이번 }, token, 90000);
        if (!pr) { 이번.forEach(x => remain.push(x)); continue; }
        const 낱장 = Array.isArray(pr.results) ? pr.results : null;
        if (낱장 && 낱장.length === 이번.length) {
          이번.forEach((x, k) => { if (!(낱장[k] && 낱장[k].ok)) remain.push(x); });
        } else {
          const 성공 = Math.max(0, Math.min(이번.length, Number(pr.uploaded) || 0));
          이번.slice(성공).forEach(x => remain.push(x));
        }
      }

      if (remain.length) {
        p.photos = remain;
        item.payload = p;
        await 큐쓰기_(db, item);
        남음++;
      } else {
        await 큐지우기_(db, item.id);
        보냄++;
      }
    } catch (_) { 남음++; }
  }

  /* 화면이 열려 있으면 결과를 알려 줍니다 (「내 점검」 새로고침용) */
  try {
    const cs = await self.clients.matchAll({ includeUncontrolled: true });
    cs.forEach(c => c.postMessage({ 종류: '전송결과', 보냄: 보냄, 남음: 남음 }));
  } catch (_) {}

  /* 남은 게 있으면 throw 해서 브라우저가 나중에 다시 부르게 합니다 */
  if (남음) throw new Error('아직 ' + 남음 + '건 남음 — 다음에 다시');
  return { 보냄: 보냄, 남음: 남음 };
}

self.addEventListener('sync', event => {
  if (event.tag === 동기이름) event.waitUntil(대기함비우기_());
});

/* ── 앱에서 버전을 물어보거나, 직접 보내 달라고 할 때 ─────── */
self.addEventListener('message', event => {
  if (event.data === 'version') { event.source.postMessage({ version: VERSION }); return; }
  /* iOS 처럼 Background Sync 가 없는 기기에서, 앱이 꺼지기 직전에 한 번 부탁합니다.
     앱이 완전히 죽으면 이것도 멈추지만, 화면 전환 정도는 버팁니다. */
  if (event.data === 'flush') event.waitUntil(대기함비우기_().catch(() => {}));
});
