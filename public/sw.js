const CACHE='pildoras-v2';
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/index.html','/manifest.webmanifest','/icon.svg']))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method==='GET'&&url.origin===location.origin&&!url.pathname.startsWith('/api/'))e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(x=>{let copy=x.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return x}).catch(()=>caches.match('/'))))});
