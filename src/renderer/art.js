// Рисование картинок установщика на canvas: баннер, боковая картинка, превью, иконка.
// Один и тот же код даёт и предпросмотр в программе, и BMP для Inno Setup.
'use strict';

const ART = (() => {
  const SIZES = {
    preview: [512, 288],
    banner: [1490, 116],
    sidebar: [492, 942],
  };
  const FONT = '"Segoe UI Variable Display", "Segoe UI", sans-serif';

  const imgCache = new Map(); // data: URL -> Promise<HTMLImageElement>
  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (!imgCache.has(url)) {
      imgCache.set(url, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      }));
    }
    return imgCache.get(url);
  }

  function rgb(hex) {
    const h = String(hex || '#f0a53a').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0'), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;
  function shade(hex, k) {
    const c = rgb(hex).map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k));
    return `rgb(${c.join(',')})`;
  }
  function hueOf(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')];
  }

  function cover(ctx, img, x, y, w, h) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const k = Math.max(w / iw, h / ih);
    const sw = w / k;
    const sh = h / k;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Шестиугольник с танком — логотип по умолчанию
  function drawLogo(ctx, cx, cy, size, accent) {
    const s = size / 40;
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(s, s);
    const g = ctx.createLinearGradient(0, 0, 40, 40);
    g.addColorStop(0, shade(accent, 0.25));
    g.addColorStop(1, shade(accent, -0.15));
    ctx.fillStyle = g;
    ctx.beginPath();
    [[20, 1.5], [37, 11], [37, 29], [20, 38.5], [3, 29], [3, 11]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a1308';
    roundRect(ctx, 9, 22, 22, 6, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(11, 22); ctx.lineTo(29, 22); ctx.lineTo(27, 18); ctx.lineTo(13, 18);
    ctx.closePath();
    ctx.fill();
    roundRect(ctx, 15, 14, 10, 5, 1.5);
    ctx.fill();
    roundRect(ctx, 24, 15.5, 9, 2, 1);
    ctx.fill();
    ctx.restore();
  }

  async function drawIconOrLogo(ctx, iconUrl, x, y, size, accent) {
    const icon = await loadImage(iconUrl);
    if (icon) {
      ctx.save();
      roundRect(ctx, x, y, size, size, size * 0.18);
      ctx.clip();
      cover(ctx, icon, x, y, size, size);
      ctx.restore();
    } else {
      drawLogo(ctx, x + size / 2, y + size / 2, size, accent);
    }
  }

  function wrapText(ctx, text, maxW, maxLines) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}…`;
    }
    return lines;
  }

  // Заглушка превью для мода без картинки: цвет от названия, крупное название
  function drawPlaceholder(ctx, w, h, name, accent, kind) {
    const hue = hueOf(name);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue},28%,11%)`);
    g.addColorStop(1, `hsl(${(hue + 40) % 360},34%,20%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
    const rg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
    rg.addColorStop(0, `hsla(${hue},80%,60%,0.25)`);
    rg.addColorStop(1, `hsla(${hue},80%,60%,0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.18;
    drawLogo(ctx, w / 2, h / 2, h * 0.75, `hsl(${hue},70%,60%)`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(h * 0.11)}px ${FONT}`;
    const lines = wrapText(ctx, name || 'Мод', w * 0.82, 2);
    const lh = h * 0.13;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
    ctx.font = `600 ${Math.round(h * 0.05)}px ${FONT}`;
    ctx.fillStyle = rgba(accent, 0.95);
    ctx.fillText({ group: 'ГРУППА МОДОВ', pack: 'МОДПАК' }[kind] || 'МОД', w / 2, h / 2 + (lines.length / 2) * lh + h * 0.07);
  }

  // node: узел дерева; url: data: URL картинки или null
  async function preview(node, url, accent, [w, h] = SIZES.preview) {
    const [c, ctx] = canvas(w, h);
    const img = await loadImage(url);
    if (img) cover(ctx, img, 0, 0, w, h);
    else drawPlaceholder(ctx, w, h, node.name, accent, node.type);
    return c;
  }

  // urls: { banner, icon }
  async function banner(project, urls, [w, h] = SIZES.banner) {
    const d = project.design;
    const accent = d.accent;
    const [c, ctx] = canvas(w, h);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#121317');
    g.addColorStop(1, shade(accent, -0.55));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const img = await loadImage(urls.banner);
    if (img) {
      cover(ctx, img, 0, 0, w, h);
      const ov = ctx.createLinearGradient(0, 0, w, 0);
      ov.addColorStop(0, 'rgba(10,11,14,0.88)');
      ov.addColorStop(0.45, 'rgba(10,11,14,0.35)');
      ov.addColorStop(0.7, 'rgba(10,11,14,0.35)');
      ov.addColorStop(1, 'rgba(10,11,14,0.8)');
      ctx.fillStyle = ov;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.globalAlpha = 0.07;
      for (let i = 0; i < 9; i++) drawLogo(ctx, w * 0.55 + i * 110, h * (i % 2 ? 0.2 : 0.85), h * 0.9, accent);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = accent;
    ctx.fillRect(0, h - 5, w, 5);
    const pad = h * 0.16;
    const icon = h - pad * 2 - 5;
    await drawIconOrLogo(ctx, urls.icon, pad * 1.3, pad, icon, accent);
    const x = pad * 1.3 + icon + pad;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(h * 0.34)}px ${FONT}`;
    ctx.fillText(d.bannerTitle || project.info.name, x, h * 0.52, w * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = `500 ${Math.round(h * 0.19)}px ${FONT}`;
    const sub = d.bannerSubtitle || [`Версия ${project.info.version}`, project.info.author].filter(Boolean).join('  •  ');
    ctx.fillText(sub, x, h * 0.8, w * 0.5);
    return c;
  }

  async function sidebar(project, urls, [w, h] = SIZES.sidebar) {
    const d = project.design;
    const accent = d.accent;
    const [c, ctx] = canvas(w, h);
    const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
    g.addColorStop(0, shade(accent, -0.45));
    g.addColorStop(1, '#0f1013');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const img = await loadImage(urls.sidebar || urls.banner);
    if (img) cover(ctx, img, 0, 0, w, h);
    const ov = ctx.createLinearGradient(0, 0, 0, h);
    ov.addColorStop(0, 'rgba(10,11,14,0.15)');
    ov.addColorStop(0.55, 'rgba(10,11,14,0.35)');
    ov.addColorStop(1, 'rgba(10,11,14,0.92)');
    ctx.fillStyle = ov;
    ctx.fillRect(0, 0, w, h);
    if (!img) {
      ctx.globalAlpha = 0.08;
      drawLogo(ctx, w * 0.5, h * 0.4, w * 1.1, accent);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = accent;
    ctx.fillRect(w - 8, 0, 8, h);
    const icon = w * 0.36;
    await drawIconOrLogo(ctx, urls.icon, (w - icon) / 2, h * 0.12, icon, accent);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(w * 0.105)}px ${FONT}`;
    const lines = wrapText(ctx, d.bannerTitle || project.info.name, w * 0.82, 3);
    const base = h * 0.78 - (lines.length - 1) * w * 0.12;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, base + i * w * 0.125));
    ctx.fillStyle = accent;
    ctx.font = `700 ${Math.round(w * 0.055)}px ${FONT}`;
    ctx.fillText(`ВЕРСИЯ ${project.info.version}`.toUpperCase(), w / 2, base + lines.length * w * 0.125 + w * 0.02);
    if (project.info.author) {
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = `500 ${Math.round(w * 0.05)}px ${FONT}`;
      ctx.fillText(project.info.author, w / 2, h * 0.95);
    }
    return c;
  }

  // ICO с PNG внутри (16–256 px)
  async function icon(project, urls) {
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const pngs = [];
    for (const s of sizes) {
      const [c, ctx] = canvas(s, s);
      await drawIconOrLogo(ctx, urls.icon, 0, 0, s, project.design.accent);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      pngs.push(new Uint8Array(await blob.arrayBuffer()));
    }
    const head = new DataView(new ArrayBuffer(6 + 16 * sizes.length));
    head.setUint16(2, 1, true);
    head.setUint16(4, sizes.length, true);
    let off = 6 + 16 * sizes.length;
    sizes.forEach((s, i) => {
      const o = 6 + i * 16;
      head.setUint8(o, s === 256 ? 0 : s);
      head.setUint8(o + 1, s === 256 ? 0 : s);
      head.setUint16(o + 4, 1, true);
      head.setUint16(o + 6, 32, true);
      head.setUint32(o + 8, pngs[i].length, true);
      head.setUint32(o + 12, off, true);
      off += pngs[i].length;
    });
    const out = new Uint8Array(off);
    out.set(new Uint8Array(head.buffer), 0);
    let p = 6 + 16 * sizes.length;
    for (const png of pngs) {
      out.set(png, p);
      p += png.length;
    }
    return out;
  }

  const toRgba = (c) => ({ w: c.width, h: c.height, rgba: new Uint8Array(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.buffer) });

  return { SIZES, loadImage, preview, banner, sidebar, icon, toRgba, rgba, shade };
})();

window.ART = ART;
