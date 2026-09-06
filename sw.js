/* APX Office — service worker
   ------------------------------------------------------
   บั๊ม CACHE_VERSION ทุกครั้งที่แก้ index.html หรือ report.html
   การบั๊มเลขจะล้างแคชเก่าทุกก้อนบนเครื่องด้วย ซึ่งเป็นวิธีที่แน่นอนที่สุด
   ในการดึงเครื่องที่ค้างอยู่กับของเก่าให้กลับมาใช้ตัวปัจจุบัน */
var CACHE_VERSION = 'apx-office-3.0.0';

/* รอเน็ตได้นานแค่ไหนก่อนจะยอมใช้ของที่เก็บไว้
   นานพอสำหรับสัญญาณอ่อนหน้างาน แต่สั้นพอที่ฟอร์มยังเปิดติด */
var NET_TIMEOUT_MS = 8000;

var APP_SHELL = [
  './',
  './index.html',
  './report.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(c){
      /* addAll ล้มทั้งชุดถ้าไฟล์เดียวพลาด จึงใส่ทีละไฟล์และยอมให้ขาดได้ */
      return Promise.all(APP_SHELL.map(function(u){
        return c.add(new Request(u, { cache: 'reload' })).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        return k === CACHE_VERSION ? null : caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* ดึงหน้าเว็บโดยไม่สนแคชของเบราว์เซอร์เอง
   ถ้าไม่ใส่ cache:'reload' เบราว์เซอร์อาจคืนของเก่าให้โดยไม่ถามเซิร์ฟเวอร์เลย
   ซึ่งเป็นสาเหตุที่เครื่องช่างเคยค้างอยู่กับฟอร์มรุ่นเก่าทั้งที่ตัวนี้ขอเน็ตก่อน */
function fetchFreshPage(url){
  return fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
}

function withTimeout(promise, ms){
  return new Promise(function(resolve, reject){
    var done = false;
    var timer = setTimeout(function(){
      if(!done){ done = true; reject(new Error('network timeout')); }
    }, ms);
    promise.then(function(v){
      if(done) return;
      done = true; clearTimeout(timer); resolve(v);
    }, function(err){
      if(done) return;
      done = true; clearTimeout(timer); reject(err);
    });
  });
}

function cachedPage(req){
  var url = new URL(req.url);
  return caches.match(url.pathname.indexOf('report') !== -1 ? './report.html' : './index.html')
    .then(function(hit){ return hit || caches.match('./'); });
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  /* ไฟล์นี้ต้องไม่ถูกตอบจากแคช ไม่งั้นเลขรุ่นจะไม่มีวันเปลี่ยนในสายตาเบราว์เซอร์
     และระบบอัปเดตก็จะไม่ทำงาน */
  if(sameOrigin && url.pathname.indexOf('sw.js') !== -1){
    e.respondWith(
      fetch(new Request(req.url, { cache: 'reload' }))
        .catch(function(){ return caches.match(req); })
    );
    return;
  }

  /* ตัวหน้าเว็บทั้งสองหน้า เอาจากเน็ตก่อนเสมอและไม่เชื่อแคชของเบราว์เซอร์
     ของที่เก็บไว้ใช้เฉพาะตอนไม่มีสัญญาณหรือสัญญาณช้ามาก */
  if(req.mode === 'navigate' ||
     (sameOrigin && (url.pathname.endsWith('index.html') || url.pathname.endsWith('report.html')))){
    e.respondWith(
      withTimeout(fetchFreshPage(req.url), NET_TIMEOUT_MS).then(function(res){
        if(!res || !res.ok) throw new Error('bad response');
        var copy = res.clone();
        var key  = url.pathname.indexOf('report') !== -1 ? './report.html' : './index.html';
        caches.open(CACHE_VERSION).then(function(c){ c.put(key, copy); });
        return res;
      }).catch(function(){
        return cachedPage(req);
      })
    );
    return;
  }

  /* ไฟล์อื่นทั้งหมด - ไอคอน, ฟอนต์ Google, และตัวสร้าง PDF จาก cdnjs

     ห้ามใช้ "เอาจากแคชก่อน" ตรงนี้เด็ดขาด
     ไฟล์ที่มาจากนอกโดเมน เบราว์เซอร์ไม่ยอมให้ service worker เปิดดูข้างใน
     จึงแยกไม่ออกว่าโหลดสำเร็จจริง หรือได้ไฟล์เปล่ากลับมาเพราะสัญญาณหลุด
     ถ้าเผลอเก็บไฟล์เสียไว้ เครื่องนั้นจะหยิบไฟล์เสียมาใช้ตลอดไป
     ตัวสร้าง PDF จะพังค้าง ปิดแอปเปิดใหม่ก็ไม่หาย เพราะไม่มีอะไรไปแตะเน็ตอีก */
  e.respondWith(
    withTimeout(fetch(req), NET_TIMEOUT_MS).then(function(res){
      if(res && (res.ok || res.type === 'opaque')){
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function(c){ c.put(req, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(hit){
        /* ต้องคืนคำตอบที่ใช้ได้จริง คืนค่าว่างจะทำให้การโหลดล้มแบบไม่มีคำอธิบาย */
        return hit || new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
