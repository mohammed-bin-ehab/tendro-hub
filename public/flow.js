(function () {
  var scene = document.getElementById('flow-scene');
  if (!scene) return;
  var svg = scene.querySelector('.flow-ribbon');
  var NS = 'http://www.w3.org/2000/svg';
  var mobile = matchMedia('(max-width: 760px)');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var mid = null, ticking = false;

  function mk(tag, cls, attrs) {
    var el = document.createElementNS(NS, tag); el.setAttribute('class', cls);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // One continuous ribbon through every stage; it narrows toward the end (perspective into depth).
  function build() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    mid = null;
    if (mobile.matches) return;
    var boxes = scene.querySelectorAll('.flow-box');
    if (!boxes.length) return;
    var sr = scene.getBoundingClientRect(), W = sr.width, H = sr.height;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var pts = [];
    boxes.forEach(function (b) {
      // layout metrics (unaffected by the scale transform)
      pts.push({ x: b.offsetLeft + b.offsetWidth / 2, y: b.offsetTop + b.offsetHeight / 2 });
    });
    pts.unshift({ x: pts[0].x, y: -10 });
    pts.push({ x: pts[pts.length - 1].x, y: H + 10 });
    var d = 'M' + pts[0].x + ' ' + pts[0].y;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], dy = (b.y - a.y) * 0.55;
      d += ' C' + a.x + ' ' + (a.y + dy) + ' ' + b.x + ' ' + (b.y - dy) + ' ' + b.x + ' ' + b.y;
    }
    var path = mk('path', '', { d: d });
    svg.appendChild(path);
    var len = path.getTotalLength(), N = 260, L = [], R = [], C = [];
    var w0 = Math.min(170, W * 0.2), w1 = 34;
    for (var j = 0; j <= N; j++) {
      var t = j / N, p = path.getPointAtLength(len * t), q = path.getPointAtLength(Math.min(len, len * t + 1)), p0 = path.getPointAtLength(Math.max(0, len * t - 1));
      var dx = q.x - p0.x, dy2 = q.y - p0.y, m = Math.hypot(dx, dy2) || 1, nx = -dy2 / m, ny = dx / m;
      var half = (w0 + (w1 - w0) * t) / 2;
      L.push((p.x + nx * half).toFixed(1) + ',' + (p.y + ny * half).toFixed(1));
      R.push((p.x - nx * half).toFixed(1) + ',' + (p.y - ny * half).toFixed(1));
      C.push(p.x.toFixed(1) + ',' + p.y.toFixed(1));
    }
    svg.removeChild(path);
    svg.appendChild(mk('polygon', 'fill', { points: L.concat(R.slice().reverse()).join(' ') }));
    svg.appendChild(mk('polyline', 'edge', { points: L.join(' ') }));
    svg.appendChild(mk('polyline', 'edge', { points: R.join(' ') }));
    mid = mk('polyline', 'mid', { points: C.join(' ') });
    svg.appendChild(mid);
  }

  // Scrolling = moving forward: stages ahead are smaller and softer, the current one is full size.
  function update() {
    ticking = false;
    var boxes = scene.querySelectorAll('.flow-box');
    if (mobile.matches || reduce.matches) {
      boxes.forEach(function (b) { b.style.removeProperty('--s'); b.style.removeProperty('--o'); });
      if (mid) mid.style.strokeDashoffset = 0;
      return;
    }
    var vh = innerHeight;
    boxes.forEach(function (b) {
      var r = b.getBoundingClientRect(), d = ((r.top + r.height / 2) - vh / 2) / vh, ahead = Math.min(Math.max(d, 0), 1), behind = Math.min(Math.max(-d, 0), 1);
      b.style.setProperty('--s', (1 - 0.1 * ahead).toFixed(3));
      b.style.setProperty('--o', (1 - 0.45 * ahead - 0.35 * behind).toFixed(3));
    });
    if (mid) mid.style.strokeDashoffset = String(-scrollY * 0.6);
  }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
  function rebuild() { build(); update(); }

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', rebuild);
  mobile.addEventListener && mobile.addEventListener('change', rebuild);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(rebuild);
  rebuild();
})();
