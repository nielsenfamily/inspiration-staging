/* Built-in painted backgrounds (drawn in code, so they work with no photos and offline).
   Photo backgrounds listed in config.js are added alongside these. */
(function () {
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const W = 1600, H = 1000;
  const svg = body => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${body}</svg>`);

  function hills(layers, r, baseY, amp) {
    return layers.map((color, i) => {
      const y0 = baseY + i * 70;
      let d = `M0 ${H} L0 ${y0}`;
      const n = 7 + i * 2;
      for (let k = 0; k <= n; k++) {
        const x = (k / n) * W;
        const y = y0 + Math.sin(k * 1.3 + i * 2.1) * amp * (1 - i * 0.12) + (r() - 0.5) * 40;
        const cx = x - W / n / 2;
        d += ` Q${cx.toFixed(0)} ${(y - amp * 0.6).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)}`;
      }
      d += ` L${W} ${H} Z`;
      return `<path d="${d}" fill="${color}"/>`;
    }).join('');
  }

  function pines(r, y, count, color, hMin, hMax) {
    let out = '';
    for (let i = 0; i < count; i++) {
      const x = r() * W, h = hMin + r() * (hMax - hMin), w = h * 0.28;
      out += `<path d="M${x} ${y - h} L${x - w / 2} ${y} L${x + w / 2} ${y} Z" fill="${color}"/>`;
    }
    return out + `<rect x="0" y="${y - 2}" width="${W}" height="${H - y + 2}" fill="${color}"/>`;
  }

  const SCENES = {
    'scene-dawn': {
      name: 'Dawn hills',
      draw() {
        const r = rng(7);
        return svg(`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#9fb7c4"/><stop offset=".55" stop-color="#e9d6bb"/><stop offset="1" stop-color="#f3e3c7"/></linearGradient>
          <radialGradient id="sun" cx=".68" cy=".46" r=".35"><stop offset="0" stop-color="#fff4d9" stop-opacity=".95"/><stop offset="1" stop-color="#fff4d9" stop-opacity="0"/></radialGradient></defs>
          <rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#sun)"/>
          ${hills(['#b9b8a6', '#97a08c', '#748470', '#55684f', '#3d4f3a'], r, 520, 46)}`);
      }
    },
    'scene-forest': {
      name: 'Misty forest',
      draw() {
        const r = rng(21);
        return svg(`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#c9d3cc"/><stop offset="1" stop-color="#e7e6da"/></linearGradient></defs>
          <rect width="${W}" height="${H}" fill="url(#s)"/>
          ${pines(r, 640, 70, '#a9b7ad', 120, 220)}${pines(r, 720, 60, '#8a9c8f', 180, 300)}
          ${pines(r, 820, 46, '#627a68', 260, 420)}${pines(r, 960, 30, '#3b5143', 380, 620)}`);
      }
    },
    'scene-dusk': {
      name: 'Evening valley',
      draw() {
        const r = rng(3);
        return svg(`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3c4766"/><stop offset=".5" stop-color="#a77a74"/><stop offset="1" stop-color="#e2b07e"/></linearGradient>
          <radialGradient id="g" cx=".3" cy=".62" r=".4"><stop offset="0" stop-color="#ffd9a0" stop-opacity=".8"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient></defs>
          <rect width="${W}" height="${H}" fill="url(#s)"/><rect width="${W}" height="${H}" fill="url(#g)"/>
          ${hills(['#7b5a63', '#5d4655', '#433647', '#2e2636', '#1f1a27'], r, 560, 52)}`);
      }
    },
    'scene-library': {
      name: 'Library shelves',
      draw() {
        const r = rng(11);
        const spines = ['#6b2f2a', '#2f4a3a', '#2d3a52', '#8a6a2f', '#4a3050', '#5a5f63', '#7a4a33', '#a3743b', '#3c5a5a', '#5e2a35'];
        let books = '';
        const shelfH = 190, top = 40;
        for (let s = 0; s < 5; s++) {
          const base = top + (s + 1) * shelfH;
          let x = 70;
          while (x < W - 90) {
            if (r() < 0.04) { x += 40 + r() * 80; continue; }
            const w = 18 + r() * 26, h = 110 + r() * 60, c = spines[Math.floor(r() * spines.length)];
            const lean = r() < 0.05 ? (r() * 10 - 5) : 0;
            books += `<g transform="rotate(${lean.toFixed(1)} ${x} ${base})"><rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}"/>` +
              `<rect x="${x.toFixed(1)}" y="${(base - h + 14).toFixed(1)}" width="${w.toFixed(1)}" height="3" fill="#c9a55a" opacity=".55"/>` +
              `<rect x="${x.toFixed(1)}" y="${(base - 22).toFixed(1)}" width="${w.toFixed(1)}" height="3" fill="#c9a55a" opacity=".45"/>` +
              `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="2" height="${h.toFixed(1)}" fill="#000" opacity=".25"/></g>`;
            x += w + 1.5;
          }
          books += `<rect x="40" y="${base}" width="${W - 80}" height="22" fill="#4a3022"/><rect x="40" y="${base}" width="${W - 80}" height="4" fill="#6d4a33"/>`;
        }
        return svg(`<defs><radialGradient id="lamp" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#ffe2a8" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient></defs>
          <rect width="${W}" height="${H}" fill="#2e1f17"/>
          <rect x="40" y="20" width="${W - 80}" height="${H}" fill="#24170f"/>${books}
          <rect x="0" y="0" width="40" height="${H}" fill="#3b271b"/><rect x="${W - 40}" y="0" width="40" height="${H}" fill="#3b271b"/>
          <rect width="${W}" height="${H}" fill="url(#lamp)"/>`);
      }
    },
    'scene-none': { name: 'No background', draw: () => null }
  };

  const cache = {};
  window.Scenes = {
    list: SCENES,
    url(id) {
      if (!SCENES[id]) return null;
      if (!(id in cache)) cache[id] = SCENES[id].draw();
      return cache[id];
    }
  };
})();
