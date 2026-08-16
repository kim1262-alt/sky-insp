/* ════════════════════════════════════════════════════════════
   서비스 워커 — 앱을 휴대폰 안에 담아두는 부품

   이게 있어야 통신이 없는 곳에서도 앱이 켜집니다.
   앱과 인터넷 사이에 앉아 있는 중개인이라고 보시면 됩니다.

     앱   : "점검 화면 줘"
     여기 : "내가 갖고 있어. 여기."      ← 인터넷을 안 거칩니다
     앱   : 화면 표시

   ⚠️ 이 파일은 【재료】입니다. 빌드하면 배포용/sw.js 로 복사되면서
      아래 20260816-1905 자리에 빌드 시각이 찍힙니다.
      배포용/sw.js 를 직접 고치지 마세요.
   ════════════════════════════════════════════════════════════ */

const VERSION = '20260816-1905';
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
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* 하나라도 실패하면 설치 전체가 실패하므로 개별적으로 담습니다 */
    await Promise.all(SHELL.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[sw] 담지 못함', url, e.message); }
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
    const cached = await cache.match(req, { ignoreSearch: true });

    if (cached) {
      /* 담아둔 것을 바로 주고, 뒤에서 조용히 새것을 받아둡니다.
         다음에 켤 때 새 화면이 나옵니다. */
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) await cache.put(req, fresh.clone());
        } catch (_) { /* 통신이 없으면 그냥 넘어갑니다 — 정상입니다 */ }
      })());
      return cached;
    }

    /* 담아둔 게 없으면 인터넷에서 받아 담아둡니다 */
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) await cache.put(req, fresh.clone());
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

/* ── 앱에서 버전을 물어볼 때 ───────────────────────────────── */
self.addEventListener('message', event => {
  if (event.data === 'version') event.source.postMessage({ version: VERSION });
});
