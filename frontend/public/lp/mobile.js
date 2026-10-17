(() => {
  const sc = document.getElementById('screen'), cnt = document.getElementById('cnt');
  const imgs = Array.from({ length: 10 }, (_, i) => { const im = document.createElement('img'); im.src = `/lp/img/walk-${String(i + 1).padStart(2, '0')}.webp`; im.alt = ''; sc.insertBefore(im, sc.firstChild); return im; });
  let i = 0; imgs[0].classList.add('on');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setInterval(() => { imgs[i].classList.remove('on'); i = (i + 1) % imgs.length; imgs[i].classList.add('on'); cnt.textContent = 'кадр ' + (i * 10 + 1); }, 1400);
})();
