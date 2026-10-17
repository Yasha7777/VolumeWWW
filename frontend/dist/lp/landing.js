(() => {
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const range = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
  const $ = (id) => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const MOBILE_BP = 900;
  const nf = (n, d = 1) => n.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });

  /* ───────── данные витрины (цифры иллюстративные; масса = объём × плотность) ───────── */
  const CASES = [
    { mat: 'Щебень гранитный', fr: 'фр. 20–40', img: '/lp/img/obhod-2.webp', v: 1428.6, rho: 1.40, l: 31.4, w: 20.2, h: 8.6, frames: 112 },
    { mat: 'Щебень', fr: 'фр. 5–20', img: '/lp/img/obhod-6.webp', v: 642.3, rho: 1.38, l: 24.1, w: 16.8, h: 6.1, frames: 96 },
    { mat: 'Отсев дробления', fr: 'фр. 0–5', img: '/lp/img/obhod-4.webp', v: 318.9, rho: 1.50, l: 19.2, w: 13.5, h: 4.7, frames: 84 },
    { mat: 'ПГС', fr: 'природная', img: '/lp/img/obhod-3.webp', v: 905.0, rho: 1.65, l: 27.8, w: 19.0, h: 6.6, frames: 104 },
    { mat: 'Грунт', fr: 'растительный', img: '/lp/img/obhod-5.webp', v: 211.7, rho: 1.60, l: 15.6, w: 11.9, h: 4.4, frames: 72 },
    { mat: 'Щебень гравийный', fr: 'фр. 5–20', img: '/lp/img/obhod-1.webp', v: 477.5, rho: 1.43, l: 21.3, w: 15.0, h: 5.8, frames: 90 },
  ];
  const STEPS = CASES.length - 1;
  const mins = (fr) => { const s = Math.round(fr / 100 * 7 * 60); return `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, '0')} с`; };

  /* ───────── декор хиро: камни, кресты, разметка (координаты холста 1536) ───────── */
  const ROCKS = [
    ['rock-m-01',175,76,84,.75],['rock-m-02',377,130,50,.95],['rock-m-03',253,145,68,.6],['rock-m-04',208,177,70,.7],['rock-m-05',329,281,77,.85],
    ['rock-m-06',1219,161,83,.7],['rock-m-07',1301,188,81,.9],['rock-m-08',1195,224,35,.5],['rock-m-09',1468,433,29,.55],
    ['rock-m-07',44,402,118,.8,40],['rock-m-01',54,548,132,.9,-25],['rock-m-06',38,700,124,.85,70],['rock-m-05',1382,470,122,.8,15],
    ['rock-m-01',1374,640,138,.95,100],['rock-m-07',1392,820,120,.85,-30],['rock-m-03',1150,352,104,.7,20],['rock-m-04',150,344,104,.7,-10],
    ['rock-m-09',96,240,40,1.1,0],['rock-m-08',1440,300,44,1.2,30],
  ];
  const HALF = 768;
  const decor = $('decor'), halves = decor.querySelectorAll('.decor__half');
  ROCKS.forEach(([s, x, y, w, z, r = 0], i) => {
    const left = x + w / 2 < HALF, el = document.createElement('span');
    el.className = 'rock';
    const side = left ? -1 : 1;
    el.style.cssText = `left:${left ? x : x - HALF}px;top:${y}px;width:${w}px;--z:${z};--sx:${(side * (60 + 90 * z)).toFixed(0)};--rr:${(side * (14 + i % 5 * 6))}`;
    el.innerHTML = `<span style="animation-duration:${9 + (i * 7) % 5}s;animation-delay:${-(i * 1.7) % 9}s"><img src="/lp/img/${s}.webp" alt="" style="transform:rotate(${r}deg)" draggable="false"></span>`;
    halves[left ? 0 : 1].appendChild(el);
  });
  const cross = (x, y, ring) => `<svg class="cross" style="left:${x - 15}px;top:${y - 15}px" viewBox="0 0 30 30"><line x1="0" y1="15" x2="30" y2="15"/><line x1="15" y1="0" x2="15" y2="30"/>${ring ? '<circle cx="15" cy="15" r="6"/>' : ''}</svg>`;
  halves[0].querySelector('.decor__far').insertAdjacentHTML('beforeend', cross(51, 130, 1) + cross(201, 245, 0) +
    `<div class="mark" style="left:78px;top:105px">61.7956° N<br>34.3686° E</div>` +
    `<div class="mark" style="left:219px;top:232px"><i></i><span style="display:inline-block">Обход<br>Объём<br>Масса</span></div>`);
  halves[1].querySelector('.decor__far').insertAdjacentHTML('beforeend', cross(1411 - HALF, 240, 1) + cross(1286 - HALF, 250, 0) + cross(1501 - HALF, 495, 0) +
    `<div class="mark" style="left:${1442 - HALF}px;top:211px">Погрешность<br>до 10 %</div>`);

  /* ───────── пыль + фонарь (как на «Анализе») ───────── */
  const cv = $('dust'), ctx = cv.getContext('2d'), light = $('light');
  const DPR = Math.min(devicePixelRatio || 1, 1.5);
  let parts = [], W = 0, H = 0;
  const st = { tx: 0, ty: 0, mx: 0, my: 0, px: -9999, py: -9999 };
  function sizeDust() {
    W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    const n = Math.round((W * H) / 15000), rnd = (a, b) => a + Math.random() * (b - a);
    parts = Array.from({ length: n }, () => { const z = rnd(.15, 1); return { x: rnd(0, W), y: rnd(0, H), z, r: rnd(.45, 1.5) * (.6 + z), vx: rnd(-.05, .05), vy: -rnd(.02, .09) * z, a: rnd(.12, .5), w: rnd(.4, 1.6), ph: rnd(0, 6.3) }; });
  }
  function drawDust(t, dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      if (!reduce) { p.x += (p.vx + Math.sin(t * .0003 * p.w + p.ph) * .04) * dt; p.y += p.vy * dt; if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; } if (p.x < -4) p.x = W + 4; else if (p.x > W + 4) p.x = -4; }
      const x = p.x - st.mx * p.z * 26, y = p.y - st.my * p.z * 16;
      let a = p.a * (.55 + .45 * Math.sin(t * .0012 * p.w + p.ph));
      const d2 = (x - st.px) ** 2 + (y - st.py) ** 2; a *= 1 + 2.2 * Math.exp(-d2 / 52000);
      ctx.fillStyle = `rgba(236,229,212,${Math.min(.9, a).toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.2832); ctx.fill();
    }
  }
  if (fine && !reduce) {
    addEventListener('pointermove', (e) => {
      st.px = e.clientX; st.py = e.clientY;
      st.tx = clamp(e.clientX / innerWidth * 2 - 1, -1, 1); st.ty = clamp(e.clientY / innerHeight * 2 - 1, -1, 1);
      decor.classList.add('has-pointer');
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { st.tx = st.ty = 0; decor.classList.remove('has-pointer'); });
  }

  /* ───────── 3D-куча (данные настоящего обхода, 44 тыс. точек) ───────── */
  const VERT = `
    attribute vec3 aColor; uniform float uSize, uProgress, uHeight, uPR, uSweep;
    varying vec3 vColor; varying float vBand, vShow, vH;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      float h = position.y / uHeight; float cut = uProgress * 1.2 - 0.08;
      vShow = step(h, cut); vBand = smoothstep(0.07, 0.0, abs(h - cut)) * (1.0 - step(1.0, uProgress));
      if (uSweep >= 0.0) vBand = max(vBand, smoothstep(0.045, 0.0, abs(h - uSweep)) * 0.9);
      vColor = aColor; vH = h; gl_PointSize = uSize * uPR / -mv.z;
    }`;
  const FRAG = `
    uniform vec3 uAccent; uniform float uIso, uGain;
    varying vec3 vColor; varying float vBand, vShow, vH;
    void main() {
      vec2 c = gl_PointCoord - 0.5; float r = dot(c, c);
      if (r > 0.25 || vShow < 0.5) discard;
      vec3 col = vColor * uGain;
      float f = fract(vH * 9.0); float iso = 1.0 - smoothstep(0.0, 0.05, min(f, 1.0 - f));
      col = mix(col, uAccent, iso * uIso * step(0.04, vH));
      col = mix(col, uAccent, vBand * 0.9);
      gl_FragColor = vec4(col * (1.0 - r * 0.9), 1.0);
    }`;
  let three = null;
  function initPile(buf) {
    if (!window.THREE) return;
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'KSPC') return;
    const n = dv.getUint32(4, true), lim = dv.getFloat32(8, true), height = dv.getFloat32(12, true);
    const q = new Int16Array(buf, 16, n * 3), pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pos[i] = (q[i] / 32767) * lim;
    const col = new Uint8Array(buf, 16 + n * 6, n * 3);
    const el = $('pileGL');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 0); el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(24, 1, .05, 60);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3, true));
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: {
      uSize: { value: 10.5 }, uProgress: { value: reduce ? 1.2 : 0 }, uHeight: { value: height || .4 }, uPR: { value: dpr },
      uAccent: { value: new THREE.Color('#8fd46a') }, uSweep: { value: -1 }, uIso: { value: .55 }, uGain: { value: 1.18 } } });
    scene.add(new THREE.Points(geo, mat));
    const lc = new THREE.Color('#3a3d38');
    const grid = new THREE.PolarGridHelper(1.6, 24, 6, 128, lc, lc); grid.material.transparent = true; grid.material.opacity = .7; grid.position.y = -.025; scene.add(grid);
    const sc = document.createElement('canvas'); sc.width = sc.height = 128; const g2 = sc.getContext('2d');
    const gr = g2.createRadialGradient(64, 64, 8, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g2.fillStyle = gr; g2.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.006; scene.add(shadow);
    const target = new THREE.Vector3(0, height * .12, 0);
    const drag = { on: false, x: 0, y: 0, th: 0, ph: 0, vel: 0 };
    const cvs = renderer.domElement; cvs.style.touchAction = 'pan-y';
    cvs.style.opacity = '0'; cvs.style.transition = 'opacity .6s ease'; requestAnimationFrame(() => { cvs.style.opacity = '1'; });
    cvs.addEventListener('pointerdown', (e) => { drag.on = true; drag.x = e.clientX; drag.y = e.clientY; drag.vel = 0; cvs.setPointerCapture?.(e.pointerId); });
    cvs.addEventListener('pointermove', (e) => { if (!drag.on) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.th -= dx * .006; drag.vel = -dx * .006; drag.ph = clamp(drag.ph + dy * .005, -.35, .5); });
    const up = () => { drag.on = false; }; cvs.addEventListener('pointerup', up); cvs.addEventListener('pointercancel', up);
    function resize() { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cvs.style.width = w + 'px'; cvs.style.height = h + 'px'; camera.aspect = w / h; camera.updateProjectionMatrix(); }
    new ResizeObserver(resize).observe(el); resize();
    three = { renderer, scene, camera, mat, target, drag, t0: performance.now(), auto: 0 };
  }
  function renderPile(now, dt, p) {
    if (!three) return;
    const { renderer, scene, camera, mat, target, drag } = three;
    const age = (now - three.t0) / 1000;
    // куча собирается снизу вверх по мере прокрутки, затем по ней проходит полоса
    mat.uniforms.uProgress.value = reduce ? 1.2 : range(p, .1, .42) * 1.2;
    mat.uniforms.uSweep.value = p > .44 ? range(p, .46, .96) * 1.06 - .03 : -1;
    if (!drag.on) { if (Math.abs(drag.vel) > 1e-4) { drag.th += drag.vel * dt; drag.vel *= Math.pow(.9, dt); } }
    if (!reduce) three.auto += dt * (16.7 / 1000) * .12;   // ≈ 0,12 рад/с — один оборот за ~50 с
    const th = .6 + three.auto + p * 1.1 + drag.th + st.mx * .25;
    const ph = clamp(.5 - p * .18 + drag.ph + st.my * .05, .1, 1.2);
    const R = 4.5 * (1 - p * .08);
    camera.position.set(target.x + R * Math.cos(ph) * Math.sin(th), target.y + R * Math.sin(ph), target.z + R * Math.cos(ph) * Math.cos(th));
    camera.lookAt(target);
    renderer.render(scene, camera);
  }

  /* ───────── сцена прокрутки ───────── */
  const heroVideo = $('heroVideo');
  const scrolly = $('scrolly'), heroLayer = $('heroLayer'), casesLayer = $('casesLayer'), heroCopy = $('heroCopy'), show = $('show');
  let vh = innerHeight, lastW = innerWidth, heroLen = 0, fadeLen = 0, appsLen = 0, appsStart = 0, endY = 0;
  function layout(force) {
    const h = Math.max(1, innerHeight);
    if (!force && innerWidth === lastW && Math.abs(h - vh) < 120) return;
    vh = h; lastW = innerWidth;
    document.documentElement.style.setProperty('--vh', h + 'px');
    // было 2.4 + 0.9 + 5×0.8 (+1 экран сцены) = 8.3 экрана до «Как это работает», стало 1.3 + 0.5 + 5×0.65 + 1 = 6.05
    heroLen = 1.3 * vh; fadeLen = .5 * vh; appsLen = STEPS * .65 * vh; appsStart = heroLen + fadeLen;   // ~2/3 экрана прокрутки на пример
    endY = appsStart + appsLen;
    scrolly.style.height = (endY + vh) + 'px';
    sizeDust();
  }

  // карточки-выноски
  const fcs = [0, 1, 2, 3].map((i) => ({ el: $('fc' + i), path: $('ld' + i), dot: $('ldc' + i), at: [.42, .54, .66, .78][i], shown: false }));
  fcs.forEach((f) => { const L = f.path.getTotalLength(); f.L = L; f.path.style.strokeDasharray = L; f.path.style.strokeDashoffset = L; });
  function countUp(el, to, ms = 1300) {
    const t0 = performance.now();
    const tick = (now) => { const k = Math.min(1, (now - t0) / ms); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString('ru-RU'); if (k < 1) requestAnimationFrame(tick); };
    if (reduce) el.textContent = to.toLocaleString('ru-RU'); else requestAnimationFrame(tick);
  }

  // витрина
  const scenes = $('scenes'), menu = $('menu'), picIn = $('picIn'), card = $('card'), dots = $('dots');
  const opts = [], scs = [], pics = [], dts = [];
  CASES.forEach((c, i) => {
    const s = document.createElement('div'); s.className = 'scene'; s.innerHTML = `<img src="${c.img}" alt="">`; scenes.appendChild(s); scs.push(s);
    const p = document.createElement('img'); p.src = c.img; p.alt = `${c.mat}, ${c.fr}: куча на площадке`; picIn.insertBefore(p, picIn.firstChild); pics.push(p);
    const o = document.createElement('button'); o.type = 'button'; o.className = 'opt'; o.setAttribute('role', 'tab'); o.id = 'case-' + i; o.setAttribute('aria-controls', 'card');
    o.innerHTML = `<span class="opt__row"><span>${c.mat}</span><small>${nf(c.v)} м³</small></span><img src="${c.img}" alt="">`;
    o.addEventListener('click', () => setIndex(i, false)); menu.appendChild(o); opts.push(o);
    const d = document.createElement('i'); dots.appendChild(d); dts.push(d);
  });
  let index = -1, navTarget = null, navUntil = 0;
  function renderCard(i) {
    const c = CASES[i], m = c.v * c.rho;
    card.innerHTML = `<h3>${c.mat}</h3><div class="card__sub">${c.fr} · обход ${c.frames} кадров</div>
      <dl class="specs">
        <div class="spec"><dt>Объём</dt><dd class="big">${nf(c.v)}<small>м³</small></dd></div>
        <div class="spec"><dt>Масса</dt><dd class="big">${nf(m)}<small>т</small></dd></div>
        <div class="spec"><dt>Насыпная плотность</dt><dd>${nf(c.rho, 2)} т/м³</dd></div>
        <div class="spec"><dt>Габариты</dt><dd>${nf(c.l)} × ${nf(c.w)} × ${nf(c.h)} м</dd></div>
        <div class="spec"><dt>Расчёт</dt><dd>≈ ${mins(c.frames)}</dd></div>
        <div class="spec"><dt>Погрешность</dt><dd><span class="tag">до 10 % по объёму</span></dd></div>
      </dl>`;
    card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap');
    $('picNo').textContent = `${String(i + 1).padStart(2, '0')} / ${String(CASES.length).padStart(2, '0')}`;
    $('dimH').textContent = `${nf(c.h)} м`; $('dimL').textContent = `${nf(c.l)} × ${nf(c.w)} м`;
  }
  function setIndex(i, fromScroll) {
    if (!Number.isFinite(i)) return;
    const next = clamp(i, 0, STEPS);
    if (next !== index) {
      index = next;
      [opts, scs, pics].forEach((l) => l.forEach((el, k) => el.classList.toggle('is-on', k === index)));
      dts.forEach((d, k) => d.classList.toggle('on', k === index));
      opts.forEach((o, k) => { o.setAttribute('aria-selected', k === index ? 'true' : 'false'); o.tabIndex = k === index ? 0 : -1; });
      card.setAttribute('aria-labelledby', opts[index].id);
      renderCard(index);
      if (innerWidth <= MOBILE_BP) { const a = opts[index].getBoundingClientRect(), mm = menu.getBoundingClientRect(); menu.scrollBy({ left: (a.left + a.width / 2) - (mm.left + mm.width / 2), behavior: 'smooth' }); }
    }
    if (!fromScroll) { navTarget = appsStart + (index / STEPS) * appsLen; navUntil = performance.now() + 1100; scrollTo({ top: navTarget, behavior: 'smooth' }); }
  }
  menu.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? STEPS : step ? index + step : null;
    if (to === null) return;
    e.preventDefault(); setIndex(to, false); opts[index].focus({ preventScroll: true });
  });
  if (fine) $('pic').addEventListener('pointermove', (e) => { const r = picIn.getBoundingClientRect(); picIn.style.setProperty('--tx', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3)); picIn.style.setProperty('--ty', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3)); });
  $('pic').addEventListener('pointerleave', () => { picIn.style.setProperty('--tx', 0); picIn.style.setProperty('--ty', 0); });

  // Примеры листаются обычной прокруткой: пример выбирается по положению страницы (см. frame()).
  // Перехват колеса и свайпа («один жест = один пример») убран 17.10: тачпад ещё ~1 с шлёт события по инерции —
  // их приходилось глотать, и страница «залипала»; на телефоне после свайпа страница сама доезжала до примера
  // и спорила с прокруткой пальцем. Клик по названию и стрелки на клавиатуре по-прежнему переводят к примеру.

  $('segHome').addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
  $('segCases').addEventListener('click', () => scrollTo({ top: appsStart, behavior: 'smooth' }));

  /* ───────── кадр ───────── */
  let pe = 0, lastFade = -1, lastOnApps = null, prev = performance.now();
  function frame(now) {
    const dt = Math.min(3, (now - prev) / 16.7); prev = now;
    const y = scrollY || 0;
    const p = clamp(y / heroLen, 0, 1);
    pe += (p - pe) * (reduce ? 1 : 1 - Math.pow(1 - .115, dt));   // сглаживание не зависит от частоты кадров
    const k = 1 - Math.pow(1 - .16, dt); st.mx += (st.tx - st.mx) * k; st.my += (st.ty - st.my) * k;
    const live = y < endY + vh;
    if (live) {
      const fadeP = range(y, heroLen, appsStart);
      if (fadeP !== lastFade) {
        lastFade = fadeP;
        heroLayer.style.opacity = 1 - fadeP; casesLayer.style.opacity = fadeP;
        heroLayer.style.visibility = fadeP === 1 ? 'hidden' : 'visible';
        casesLayer.style.visibility = fadeP === 0 ? 'hidden' : 'visible';
      }
      if (fadeP < 1) {
        // хиро: текст уходит вверх, куча выходит в центр, камни разлетаются
        const tOut = range(pe, .02, .3);
        heroCopy.style.transform = `translate3d(0, ${(-tOut * 120).toFixed(1)}px, 0)`;
        heroCopy.style.opacity = (1 - tOut).toFixed(3);
        heroCopy.style.pointerEvents = tOut > .6 ? 'none' : '';
        const vOut = range(pe, .06, .38);
        heroVideo.style.opacity = (1 - vOut).toFixed(3);
        heroVideo.style.transform = `scale(${(1 + vOut * .08).toFixed(4)})`;
        show.style.opacity = range(pe, .05, .2).toFixed(3);
        show.style.pointerEvents = pe > .15 ? '' : 'none';
        const mob = innerWidth <= MOBILE_BP;
        show.style.transform = `translate3d(-50%, ${(-range(pe, .02, .35) * vh * (mob ? .12 : .17)).toFixed(1)}px, 0) scale(${(1 + range(pe, .02, .4) * (mob ? .06 : .06)).toFixed(4)})`;
        decor.style.setProperty('--p', pe.toFixed(4));
        decor.style.setProperty('--plate', range(pe, .08, .4).toFixed(3));   // груды проявляются, когда уходит видео
        decor.style.setProperty('--mx', st.mx.toFixed(3)); decor.style.setProperty('--my', st.my.toFixed(3));
        light.style.transform = `translate3d(${st.px - 550}px, ${st.py - 550}px, 0)`;
        fcs.forEach((f) => {
          const t = range(pe, f.at, f.at + .14);
          f.path.style.strokeDashoffset = (f.L * (1 - t)).toFixed(1);
          f.dot.classList.toggle('on', t > .95);
          const on = t > .55;
          if (on !== f.el.classList.contains('on')) f.el.classList.toggle('on', on);
          if (on && !f.shown) { f.shown = true; f.el.querySelectorAll('[data-count]').forEach((n) => countUp(n, +n.dataset.count)); }
        });
        drawDust(now, dt);
        renderPile(now, dt, pe);
      }
      // пока страница доезжает до выбранного примера, прокрутка индекс не трогает — иначе карточка мигает
      if (navTarget !== null) { if (Math.abs(y - navTarget) < 3 || now > navUntil) navTarget = null; }
      else { const raw = range(y, appsStart, endY) * STEPS; if (index < 0 || Math.abs(raw - index) > .6) setIndex(Math.round(raw), true); }
      const onApps = fadeP > .5;
      if (onApps !== lastOnApps) { lastOnApps = onApps; $('segHome').classList.toggle('is-on', !onApps); $('segCases').classList.toggle('is-on', onApps); }
    }
    flowFx(y);
    requestAnimationFrame(frame);
  }

  /* ───────── поток: лист отчёта, камни, появление ───────── */
  const sheet = $('sheet'), sheetZone = $('sheetZone'), badge = $('badge'), zrocks = [...document.querySelectorAll('.zrock')];
  let lastFlowY = -1;
  function flowFx(y) {
    if (y === lastFlowY) return; lastFlowY = y;
    const r = sheetZone.getBoundingClientRect();
    if (r.bottom < -200 || r.top > innerHeight + 200) return;
    const q = clamp(1 - (r.top - innerHeight * .2) / (innerHeight * .8), 0, 1);
    sheet.style.setProperty('--rx', `${((1 - q) * 12).toFixed(2)}deg`);
    sheet.style.setProperty('--ry', `${((1 - q) * -8).toFixed(2)}deg`);
    sheet.style.setProperty('--ty', `${((1 - q) * 50).toFixed(1)}px`);
    const mid = (r.top + r.height / 2 - innerHeight / 2);
    badge.style.setProperty('--by', `${(mid * -.12).toFixed(1)}px`);
    zrocks.forEach((z) => { z.style.setProperty('--zy', `${(mid * +z.dataset.speed).toFixed(1)}px`); z.style.setProperty('--zr', `${(mid / innerHeight * +z.dataset.rot).toFixed(1)}deg`); });
  }

  // появление при прокрутке: всё, что на входе ниже экрана — проявляется, остальное видно сразу
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.remove('pre'); io.unobserve(e.target);
      if (e.target.id === 'ctaBox') e.target.classList.add('drawn');
    }), { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.rv').forEach((el) => { el.classList.add('pre'); io.observe(el); });
    setTimeout(() => document.querySelectorAll('.rv.pre').forEach((el) => { el.classList.remove('pre'); if (el.id === 'ctaBox') el.classList.add('drawn'); }), 9000);
  } else $('ctaBox').classList.add('drawn');

  /* ───────── 01: настоящий обход — облако кучи и 88 положений телефона ───────── */
  // Обход кучи 08.10.2026 (iPhone 12 mini): облако DUSt3R и позы ARKit в одной системе координат.
  // data/walk-14.bin — точки кучи (формат как у кучи первого экрана: 'KSPC', n, lim, высота, int16 xyz, uint8 rgb),
  // data/walk-14.json — положения телефона [x,y,z, вперёд, вправо, вверх], длительность, номера кадров для окошка.
  // Начало координат — центр кольца камер на уровне земли, метры. Сторона кучи загорается в цвете, когда телефон её проходит.
  const WALK = Array.from({ length: 10 }, (_, i) => `/lp/img/walk-${String(i + 1).padStart(2, '0')}.webp`);   // лента кадров в шаге 02
  const SHOTS = Array.from({ length: 12 }, (_, i) => `/lp/img/walk14-${String(i + 1).padStart(2, '0')}.webp`);
  const rFrame = $('rFrame'), walkEl = $('walkGL');
  const ROUTE_MS = 7600;
  let routeOn = false, routeT0 = 0, lastCam = -1, lastShot = 0, walk = null, walkReq = false;
  const WALK_VERT = `
    attribute vec3 aColor; uniform float uSize, uPR, uSweep, uStart, uDir;
    varying vec3 vColor; varying float vShow;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      float a = mod(uDir * (atan(position.z, position.x) - uStart), 6.2832);   // сторона кучи: угол от первого кадра по ходу обхода
      vShow = step(a, uSweep); vColor = aColor; gl_PointSize = uSize * uPR / -mv.z;
    }`;
  const WALK_FRAG = `
    uniform float uGain; varying vec3 vColor; varying float vShow;
    void main() {
      vec2 c = gl_PointCoord - 0.5; float r = dot(c, c);
      if (r > 0.25) discard;
      // ещё не снятая сторона — тусклый серый силуэт (иначе куча посреди обхода выглядит пустой скорлупой), снятая — в цвете
      vec3 ghost = vec3(dot(vColor, vec3(.3, .59, .11))) * .2;
      gl_FragColor = vec4(mix(ghost, vColor * uGain, vShow) * (1.0 - r * 0.9), 1.0);
    }`;
  function walkLoad() {
    if (walkReq || !window.THREE) return; walkReq = true;
    SHOTS.forEach((src) => { const im = new Image(); im.src = src; });
    Promise.all([fetch('/lp/data/walk-14.bin').then((r) => { if (!r.ok) throw new Error('walk'); return r.arrayBuffer(); }), fetch('/lp/data/walk-14.json').then((r) => r.json())])
      .then(([buf, meta]) => initWalk(buf, meta)).catch(() => {});
  }
  function initWalk(buf, meta) {
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'KSPC') return;
    const n = dv.getUint32(4, true), lim = dv.getFloat32(8, true);
    const q = new Int16Array(buf, 16, n * 3), pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) pos[i] = (q[i] / 32767) * lim;
    const col = new Uint8Array(buf, 16 + n * 6, n * 3), C = meta.cams, N = C.length;
    // направление обхода и пройденный угол у каждого кадра (без перескока через 360°)
    const az = C.map((c) => Math.atan2(c[2], c[0]));
    let turn = 0; const steps = az.map((a, i) => { if (!i) return 0; let d = a - az[i - 1]; d -= Math.round(d / 6.2832) * 6.2832; turn += d; return d; });
    const dir = Math.sign(turn) || 1; let acc = 0; const camAz = steps.map((d) => (acc += dir * d));
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr); renderer.setClearColor(0x000000, 0); walkEl.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3, true));
    const mat = new THREE.ShaderMaterial({ vertexShader: WALK_VERT, fragmentShader: WALK_FRAG, uniforms: {
      uSize: { value: 30 }, uPR: { value: dpr }, uSweep: { value: 0 }, uStart: { value: az[0] }, uDir: { value: dir }, uGain: { value: 1.1 } } });
    scene.add(new THREE.Points(geo, mat));
    const lc = new THREE.Color('#3a3d38'), grid = new THREE.PolarGridHelper(meta.R * 1.12, 24, 6, 128, lc, lc);
    grid.material.transparent = true; grid.material.opacity = .65; scene.add(grid);
    // путь телефона: весь — бледный, пройденный — зелёный, каждый кадр — золотая точка
    const path = new Float32Array(N * 3); C.forEach((c, i) => path.set([c[0], c[1], c[2]], i * 3));
    const pathGeo = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(path, 3)); return g; };
    scene.add(new THREE.Line(pathGeo(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .14 })));
    const done = new THREE.Line(pathGeo(), new THREE.LineBasicMaterial({ color: 0x8fd46a })); scene.add(done);
    const dots = new THREE.Points(pathGeo(), new THREE.PointsMaterial({ color: 0xe8c25a, size: 3 * dpr, sizeAttenuation: false })); scene.add(dots);
    // где телефон сейчас — белая точка
    const cur = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ color: 0xffffff, size: 7 * dpr, sizeAttenuation: false }));
    scene.add(cur);
    function resize() {
      const w = walkEl.clientWidth, h = walkEl.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
      camera.aspect = w / h; camera.setViewOffset(w, h, w * .03, -h * .07, w, h); camera.updateProjectionMatrix();   // кучу чуть ниже и левее: справа сверху окошко кадра
      // расстояние, при котором кольцо обхода занимает ~90 % ширины
      if (walk) walk.dist = (meta.R + .4) * 2 / .9 / (camera.aspect * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    }
    walk = { renderer, scene, camera, mat, done, dots, cur, C, N, camAz, meta, t0: performance.now(), dist: meta.R * 2.6 };
    new ResizeObserver(resize).observe(walkEl); resize();
    if (reduce && routeOn) routeTick(performance.now());
  }
  function renderWalk(k, idx, now) {
    const w = walk, m = w.meta;
    w.mat.uniforms.uSweep.value = k >= 1 ? 7 : w.camAz[idx] + .04;
    w.done.geometry.setDrawRange(0, idx + 1); w.dots.geometry.setDrawRange(0, idx + 1);
    w.cur.position.set(w.C[idx][0], w.C[idx][1], w.C[idx][2]);
    const th = 2.2 + (reduce ? 0 : (now - w.t0) / 1000 * .07), ph = .45, R = w.dist, ty = m.height * .25;   // облёт ≈ 90 с на круг, высота ≈ 26° (выше видна впадина на вершине — там вырезано дерево)
    w.camera.position.set(R * Math.cos(ph) * Math.cos(th), ty + R * Math.sin(ph), R * Math.cos(ph) * Math.sin(th));
    w.camera.lookAt(0, ty, 0); w.renderer.render(w.scene, w.camera);
  }
  function routeTick(now) {
    if (!routeOn) return;
    const t = ((now - routeT0) % (ROUTE_MS + 1400)) / ROUTE_MS, k = reduce ? 1 : Math.min(1, t);
    const N = walk ? walk.N : 88, idx = Math.min(N - 1, Math.floor(k * N)), dur = walk ? walk.meta.duration : 45;
    if (idx !== lastCam) {
      lastCam = idx;
      const shots = walk ? walk.meta.shots : SHOTS.map((_, s) => Math.round(s * (N - 1) / (SHOTS.length - 1)));
      let si = 0; shots.forEach((f, s) => { if (f <= idx) si = s; });
      if (si !== lastShot) { lastShot = si; rFrame.src = SHOTS[si]; }
    }
    const cnt = Math.round(k * N); $('rCount').textContent = cnt; $('rFrameN').textContent = 'кадр ' + Math.max(1, cnt);
    const s = Math.round(k * dur); $('rTime').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    if (walk) renderWalk(k, idx, now);
    if (!reduce) requestAnimationFrame(routeTick);
  }
  // данные сцены (≈ 240 КБ) подтягиваем заранее, когда до шага 01 остаётся около экрана
  new IntersectionObserver((es, o) => { if (es.some((e) => e.isIntersecting)) { walkLoad(); o.disconnect(); } }, { rootMargin: '700px 0px' }).observe(walkEl);
  /* 02: загрузка */
  const belt = $('uBelt'); belt.innerHTML = [...WALK, ...WALK].map((s) => `<img src="${s}" alt="">`).join('');
  let uplOn = false, uplT0 = 0;
  function uplTick(now) {
    if (!uplOn) return;
    const cyc = 5200, t = ((now - uplT0) % cyc) / 4000, k = Math.min(1, t);
    const e = 1 - Math.pow(1 - k, 2);
    $('uRing').style.strokeDashoffset = (377 * (1 - e)).toFixed(1);
    $('uNum').textContent = Math.round(e * 100);
    const s = $('uState'); const done = k >= 1;
    if (s.classList.contains('ok') !== done) { s.classList.toggle('ok', done); s.textContent = done ? 'Отправлено ✓ расчёт начался' : 'Отправляем…'; }
    requestAnimationFrame(uplTick);
  }
  /* 03: результат */
  const res = $('visRes');
  function resRun() {
    res.classList.remove('go'); void res.offsetWidth; res.classList.add('go');
    res.querySelectorAll('[data-to]').forEach((n) => { n.textContent = '0'; setTimeout(() => countUp(n, +n.dataset.to, 1400), 500); });
  }
  let resTimer = 0;
  const vio = new IntersectionObserver((es) => es.forEach((e) => {
    const id = e.target.id;
    if (id === 'visRoute') { if (e.isIntersecting && !routeOn) { walkLoad(); routeOn = true; routeT0 = performance.now(); lastCam = -1; requestAnimationFrame(routeTick); } else if (!e.isIntersecting) routeOn = false; }
    if (id === 'visUpl') { if (e.isIntersecting && !uplOn) { uplOn = true; uplT0 = performance.now(); requestAnimationFrame(uplTick); } else if (!e.isIntersecting) uplOn = false; }
    if (id === 'visRes') { clearInterval(resTimer); if (e.isIntersecting) { resRun(); if (!reduce) resTimer = setInterval(resRun, 6500); } }
  }), { threshold: .35 });
  ['visRoute', 'visUpl', 'visRes'].forEach((id) => vio.observe($(id)));

  /* ───────── вопросы ───────── */
  document.querySelectorAll('.qa__item').forEach((it) => {
    const b = it.querySelector('.qa__q');
    b.addEventListener('click', () => { const open = !it.classList.contains('open'); it.classList.toggle('open', open); b.setAttribute('aria-expanded', open); });
  });

  /* ───────── запуск: первый экран виден сразу, модель кучи догружается в фоне ───────── */
  // заголовок появляется по словам
  document.querySelectorAll('#h1 > span').forEach((line, li) => { line.innerHTML = line.textContent.split(' ').map((w, i) => `<span class="w" style="transition-delay:${(li * .28 + i * .08).toFixed(2)}s">${w}</span>`).join(' '); });
  layout(true);
  addEventListener('resize', () => layout(false));
  addEventListener('orientationchange', () => layout(true));
  setIndex(0, true);
  requestAnimationFrame(frame);
  // заголовок проявляется на первом кадре; таймер — запасной путь, если кадры не идут (вкладка открыта в фоне)
  const goLive = () => document.body.classList.add('is-live');
  requestAnimationFrame(goLive); setTimeout(goLive, 400);
  // куча (≈390 КБ, двоичный файл) видна только после прокрутки, поэтому первый экран её не ждёт:
  // качаем после загрузки страницы, с первой прокруткой или через 2,5 с — что наступит раньше
  let pileReq = false;
  function loadPile() {
    if (pileReq) return; pileReq = true;
    fetch('/lp/data/pile-178.bin').then((res) => { if (!res.ok) throw new Error('pile'); return res.arrayBuffer(); }).then(initPile).catch(() => {});
  }
  if (document.readyState === 'complete') loadPile(); else addEventListener('load', loadPile, { once: true });
  addEventListener('scroll', loadPile, { once: true, passive: true });
  setTimeout(loadPile, 2500);
})();
