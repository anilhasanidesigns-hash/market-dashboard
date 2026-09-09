// ==============================================================================
// charts.js — small dependency-free canvas line chart.
//
// We deliberately do not pull in a charting library over CDN: the data shape
// here (one price series, one tooltip, time/price axis labels) is simple
// enough that a ~150-line canvas renderer is more reliable than a network
// dependency, and keeps the app working offline once cached.
//
// A chart instance only ever renders points it was given. If a series is
// empty (no historical data available from the provider for that period),
// it renders an explicit "No historical data available" state — never a
// synthetic line.
// ==============================================================================

class SparkChart {
  constructor(canvas, { positiveColor, negativeColor, gridColor, textColor } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = []; // [{t, close}]
    this.positiveColor = positiveColor || getCssVar('--positive');
    this.negativeColor = negativeColor || getCssVar('--negative');
    this.gridColor = gridColor || getCssVar('--border');
    this.textColor = textColor || getCssVar('--text-secondary');
    this.dpr = window.devicePixelRatio || 1;
    this.hoverX = null;

    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);
    canvas.addEventListener('mousemove', this._onMove);
    canvas.addEventListener('mouseleave', this._onLeave);
    canvas.addEventListener('touchmove', this._onMove, { passive: true });
    canvas.addEventListener('touchend', this._onLeave);

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement || canvas);
  }

  destroy() {
    this._ro.disconnect();
    this.canvas.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('mouseleave', this._onLeave);
  }

  setData(points) {
    this.points = (points || []).filter((p) => typeof p.close === 'number');
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(rect.width, 40);
    const h = Math.max(rect.height, 40);
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.width = w;
    this.height = h;
    this.render();
  }

  _onMove(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    this.hoverX = clientX - rect.left;
    this.render();
  }

  _onLeave() {
    this.hoverX = null;
    this.render();
  }

  render() {
    const { ctx, width, height, points, dpr } = this;
    if (!ctx || !width) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padL = 8;
    const padR = 54;
    const padT = 14;
    const padB = 20;
    const plotW = Math.max(width - padL - padR, 10);
    const plotH = Math.max(height - padT - padB, 10);

    if (!points.length) {
      ctx.fillStyle = this.textColor;
      ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No historical data available', width / 2, height / 2);
      ctx.restore();
      return;
    }

    const closes = points.map((p) => p.close);
    let min = Math.min(...closes);
    let max = Math.max(...closes);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;

    const xAt = (i) => padL + (i / (points.length - 1 || 1)) * plotW;
    const yAt = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;

    // grid lines (3 horizontal)
    ctx.strokeStyle = this.gridColor;
    ctx.lineWidth = 1;
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.fillStyle = this.textColor;
    ctx.textAlign = 'left';
    for (let i = 0; i <= 2; i++) {
      const v = min + ((max - min) * i) / 2;
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(formatCompact(v), padL + plotW + 6, y + 3);
    }

    const trendUp = closes[closes.length - 1] >= closes[0];
    const lineColor = trendUp ? this.positiveColor : this.negativeColor;

    // area fill
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, hexToRgba(lineColor, 0.25));
    grad.addColorStop(1, hexToRgba(lineColor, 0.02));
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.close);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xAt(points.length - 1), padT + plotH);
    ctx.lineTo(xAt(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i);
      const y = yAt(p.close);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.75;
    ctx.stroke();

    // time labels (first / last)
    ctx.fillStyle = this.textColor;
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(formatTimeLabel(points[0].t), padL, height - 4);
    ctx.textAlign = 'right';
    ctx.fillText(formatTimeLabel(points[points.length - 1].t), padL + plotW, height - 4);

    // hover tooltip
    if (this.hoverX !== null) {
      const clampedX = Math.min(Math.max(this.hoverX, padL), padL + plotW);
      const idx = Math.round(((clampedX - padL) / plotW) * (points.length - 1));
      const p = points[Math.max(0, Math.min(points.length - 1, idx))];
      const x = xAt(idx);
      const y = yAt(p.close);

      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.strokeStyle = this.gridColor;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();

      const label = `${formatCompact(p.close)}  ·  ${formatTimeLabel(p.t)}`;
      ctx.font = '11px "IBM Plex Mono", monospace';
      const tw = ctx.measureText(label).width + 12;
      let boxX = x + 8;
      if (boxX + tw > width) boxX = x - tw - 8;
      ctx.fillStyle = getCssVar('--bg-surface-raised');
      ctx.strokeStyle = this.gridColor;
      ctx.lineWidth = 1;
      roundRect(ctx, boxX, padT, tw, 20, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = getCssVar('--text-primary');
      ctx.textAlign = 'left';
      ctx.fillText(label, boxX + 6, padT + 14);
    }

    ctx.restore();
  }
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

function formatTimeLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  }
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(d);
}

function formatCompact(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888';
}

function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  const num = parseInt(hex, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

window.SparkChart = SparkChart;
window.ChartUtils = { formatCompact, formatTimeLabel };
