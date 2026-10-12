// ¿Llueve? — lluvia del Valle de Aburrá con datos de SIATA.
(() => {
  'use strict';

  // ---------- escalas ----------
  // Umbrales en mm para cada periodo: [poca, moderada, fuerte, muy fuerte]
  const PERIODOS = {
    m30: { nombre: 'Ahora', corto: '30 min', ayuda: 'Lluvia caída en los últimos 30 minutos.', umbrales: [0, 1.25, 5, 15] },
    h1: { nombre: '1 hora', corto: '1 h', ayuda: 'Lluvia acumulada en la última hora.', umbrales: [0, 2.5, 10, 30] },
    h24: { nombre: '24 horas', corto: '24 h', ayuda: 'Lluvia acumulada desde esta hora de ayer.', umbrales: [0, 5, 20, 50] },
    h72: { nombre: '3 días', corto: '3 días', ayuda: 'Lluvia acumulada en los últimos 3 días.', umbrales: [0, 10, 40, 80] },
    d30: { nombre: '30 días', corto: '30 días', ayuda: 'Lluvia acumulada en el último mes.', umbrales: [0, 50, 150, 300] },
  };
  const NIVELES = ['Nada', 'Poca', 'Moderada', 'Fuerte', 'Muy fuerte'];
  const css = getComputedStyle(document.documentElement);
  const COLORES = [0, 1, 2, 3, 4].map((i) => css.getPropertyValue(`--l${i}`).trim());

  const nivelDe = (mm, p) => {
    if (mm == null || mm <= 0) return 0;
    const u = PERIODOS[p].umbrales;
    return mm >= u[3] ? 4 : mm >= u[2] ? 3 : mm >= u[1] ? 2 : 1;
  };
  const fmt = (mm) => (mm == null ? '—' : mm >= 100 ? Math.round(mm).toString() : mm >= 10 ? mm.toFixed(1) : mm.toFixed(1).replace(/\.0$/, ''));
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bonito = (nombre) => nombre.replace(/\s*-\s*(Pluviometro|Meteorologica( Vaisala)?|Thies)$/i, '').trim();
  const hora = (d) => d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' });
  const $ = (id) => document.getElementById(id);
  const guardar = (k, v) => { try { localStorage.setItem('llueve.' + k, v); } catch {} };
  const leer = (k) => { try { return localStorage.getItem('llueve.' + k); } catch { return null; } };

  const TILDES = { Medellin: 'Medellín', Itagui: 'Itagüí', 'San Jeronimo': 'San Jerónimo' };
  const tilde = (t) => String(t || '').replace(/\b(Medellin|Itagui|San Jeronimo)\b/g, (m) => TILDES[m]);

  // ---------- estado ----------
  let periodo = PERIODOS[leer('periodo')] ? leer('periodo') : 'm30';
  let estaciones = [];
  let elegida = null;
  const marcadores = new Map();

  // ---------- mapa ----------
  const mapa = L.map('mapa', { zoomControl: false, maxZoom: 16, attributionControl: true }).setView([6.24, -75.58], 12);
  L.control.zoom({ position: 'topleft' }).addTo(mapa);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Mapa © Esri · Datos SIATA', maxZoom: 16,
  }).addTo(mapa);
  mapa.createPane('etiquetas');
  mapa.getPane('etiquetas').style.zIndex = 450;
  mapa.getPane('etiquetas').style.pointerEvents = 'none';
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16, pane: 'etiquetas', opacity: 0.55,
  }).addTo(mapa);
  mapa.createPane('estaciones');
  mapa.getPane('estaciones').style.zIndex = 620;

  function iconoDe(e) {
    const n = nivelDe(e.mm[periodo], periodo);
    const tam = [9, 13, 16, 19, 22][n];
    const lloviendo = periodo === 'm30' || periodo === 'h1' ? n > 0 : (e.mm.m30 || 0) > 0;
    const clase = ['estacion', lloviendo ? 'late' : '', elegida === e ? 'elegida' : ''].join(' ');
    return L.divIcon({
      className: '',
      html: `<div class="${clase}" style="width:${tam}px;height:${tam}px;background:${COLORES[n]};color:${COLORES[Math.max(n, 1)]}"></div>`,
      iconSize: [tam, tam],
      iconAnchor: [tam / 2, tam / 2],
    });
  }

  function pintarMapa() {
    for (const e of estaciones) {
      let m = marcadores.get(e.id + e.nombre);
      const z = Math.round((e.mm[periodo] || 0) * 100);
      if (!m) {
        m = L.marker([e.lat, e.lon], { pane: 'estaciones', keyboard: false })
          .on('click', () => abrirTarjeta(e))
          .bindTooltip('', { direction: 'top', offset: [0, -8] })
          .addTo(mapa);
        marcadores.set(e.id + e.nombre, m);
      }
      m.setIcon(iconoDe(e));
      m.setZIndexOffset(z);
      m.setTooltipContent(`<b>${esc(bonito(e.nombre))}</b><br>${fmt(e.mm[periodo])} mm · ${PERIODOS[periodo].corto}`);
    }
    pintarLeyenda();
  }

  function pintarLeyenda() {
    const u = PERIODOS[periodo].umbrales;
    const rangos = ['0', `< ${u[1]}`, `${u[1]}–${u[2]}`, `${u[2]}–${u[3]}`, `> ${u[3]}`];
    $('leyenda').innerHTML = `<p>Lluvia · ${PERIODOS[periodo].corto} (mm)</p>` +
      NIVELES.map((n, i) => `<div><i style="background:${COLORES[i]}"></i>${n}<span>${rangos[i]}</span></div>`).reverse().join('');
  }

  // ---------- panel: resumen ----------
  function pintarResumen() {
    const lloviendo = estaciones.filter((e) => (e.mm.m30 || 0) > 0);
    const porMuni = {};
    lloviendo.forEach((e) => { porMuni[e.municipio] = (porMuni[e.municipio] || 0) + 1; });

    if (lloviendo.length) {
      const fuerte = [...lloviendo].sort((a, b) => (b.mm.h1 || 0) - (a.mm.h1 || 0))[0];
      const nivel = NIVELES[nivelDe(fuerte.mm.h1, 'h1')].toLowerCase();
      $('titular').innerHTML = `Está lloviendo en <em>${lloviendo.length}</em> ${lloviendo.length === 1 ? 'sitio' : 'sitios'} del valle`;
      $('bajada').innerHTML = `Lo más fuerte: <b>${esc(bonito(fuerte.nombre))}</b> (${esc(fuerte.municipio)}), ` +
        `<b>${fmt(fuerte.mm.h1)} mm</b> en la última hora — lluvia ${nivel}.`;
    } else {
      const mas24 = [...estaciones].sort((a, b) => (b.mm.h24 || 0) - (a.mm.h24 || 0))[0];
      $('titular').textContent = 'No está lloviendo ahora en el valle';
      $('bajada').innerHTML = mas24 && mas24.mm.h24 > 0
        ? `En las últimas 24 horas donde más llovió fue <b>${esc(bonito(mas24.nombre))}</b> (${esc(mas24.municipio)}), con <b>${fmt(mas24.mm.h24)} mm</b>.`
        : 'Tampoco ha llovido en las últimas 24 horas.';
    }
    $('municipios').innerHTML = Object.entries(porMuni).sort((a, b) => b[1] - a[1])
      .map(([m, n]) => `<li>${esc(m)}<b>${n}</b></li>`).join('');
  }

  function pintarTop() {
    const p = PERIODOS[periodo];
    $('periodo-ayuda').textContent = p.ayuda;
    $('top-titulo').textContent = periodo === 'm30' ? 'Donde más llueve ahora' : `Donde más llovió · ${p.nombre}`;
    const top = estaciones.filter((e) => (e.mm[periodo] || 0) > 0)
      .sort((a, b) => b.mm[periodo] - a.mm[periodo]).slice(0, 6);
    $('top').innerHTML = top.length
      ? top.map((e, i) => `<li data-i="${estaciones.indexOf(e)}">
          <span class="punto" style="background:${COLORES[nivelDe(e.mm[periodo], periodo)]}"></span>
          <span class="nombre">${esc(bonito(e.nombre))}<small>${esc(e.lugar)}</small></span>
          <span class="mm">${fmt(e.mm[periodo])}<small> mm</small></span></li>`).join('')
      : `<li class="vacio">Ninguna estación registró lluvia en este periodo.</li>`;
    document.querySelectorAll('#top li[data-i]').forEach((li) => li.addEventListener('click', () => {
      const e = estaciones[+li.dataset.i];
      mapa.flyTo([e.lat, e.lon], 13, { duration: 0.8 });
      abrirTarjeta(e);
    }));
  }

  function elegirPeriodo(p) {
    periodo = p;
    guardar('periodo', p);
    document.querySelectorAll('#periodos button').forEach((b) => b.classList.toggle('activo', b.dataset.p === p));
    pintarMapa();
    pintarTop();
    if (elegida) abrirTarjeta(elegida);
  }
  document.querySelectorAll('#periodos button').forEach((b) => b.addEventListener('click', () => elegirPeriodo(b.dataset.p)));

  // ---------- tarjeta ----------
  const GRAF_DE = { m30: 'h3', h1: 'h3', h24: 'h24', h72: 'h72', d30: 'd30' };
  function abrirTarjeta(e, graf) {
    const anterior = elegida;
    elegida = e;
    if (anterior && anterior !== e) marcadores.get(anterior.id + anterior.nombre)?.setIcon(iconoDe(anterior));
    marcadores.get(e.id + e.nombre)?.setIcon(iconoDe(e));

    const nAhora = nivelDe(e.mm.m30, 'm30');
    const estado = nAhora > 0 ? `Lloviendo ahora · ${NIVELES[nAhora].toLowerCase()}` : 'No llueve ahora';
    graf = graf || GRAF_DE[periodo];
    const tabs = [['h3', '3 horas'], ['h24', '24 horas'], ['h72', '3 días'], ['d30', '30 días']];
    $('tarjeta-cuerpo').innerHTML = `
      <span class="t-estado"><i style="background:${COLORES[nAhora]}"></i>${estado}</span>
      <h2 class="t-nombre">${esc(bonito(e.nombre))}</h2>
      <p class="t-lugar">${esc(e.lugar)}${e.cuenca ? ' · ' + esc(e.cuenca) : ''}</p>
      <div class="t-cifras">
        <div><b>${fmt(e.mm.h1)}<small> mm</small></b><span>última hora</span></div>
        <div><b>${fmt(e.mm.h24)}<small> mm</small></b><span>24 horas</span></div>
        <div><b>${fmt(e.mm.h72)}<small> mm</small></b><span>3 días</span></div>
      </div>
      <div class="t-graf-tabs">${tabs.map(([k, n]) => `<button data-g="${k}" class="${k === graf ? 'activo' : ''}">${n}</button>`).join('')}</div>
      <div class="t-graf">${e.graficas[graf]
        ? `<img src="${esc(e.graficas[graf])}?t=${Math.floor(Date.now() / 300000)}" alt="Gráfica de lluvia de SIATA" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('p'),{textContent:'SIATA no tiene gráfica para este periodo.',style:'color:#566173;font-size:13px'}))">`
        : '<p style="color:#566173;font-size:13px">Sin gráfica.</p>'}</div>
      <p class="t-pie">Estación ${esc(e.id)} · 30 días: ${fmt(e.mm.d30)} mm · dato de ${esc(e.actualizado.slice(11, 16))}</p>`;
    document.querySelectorAll('.t-graf-tabs button').forEach((b) => b.addEventListener('click', () => abrirTarjeta(e, b.dataset.g)));
    $('tarjeta').hidden = false;
  }
  function cerrarTarjeta() {
    $('tarjeta').hidden = true;
    const e = elegida;
    elegida = null;
    if (e) marcadores.get(e.id + e.nombre)?.setIcon(iconoDe(e));
  }
  $('tarjeta-cerrar').addEventListener('click', cerrarTarjeta);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrarTarjeta(); });

  // ---------- aviso ----------
  let avisoT;
  function aviso(texto, ms = 5000) {
    $('aviso').textContent = texto;
    $('aviso').hidden = false;
    clearTimeout(avisoT);
    avisoT = setTimeout(() => { $('aviso').hidden = true; }, ms);
  }

  // ---------- datos de lluvia ----------
  async function cargarLluvia() {
    try {
      const r = await fetch('/api/lluvia');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const id = elegida && elegida.id + elegida.nombre;
      estaciones = j.estaciones.map((e) => ({ ...e, municipio: tilde(e.municipio), lugar: tilde(e.lugar) }));
      elegida = id ? estaciones.find((e) => e.id + e.nombre === id) || null : null;
      pintarResumen();
      pintarMapa();
      pintarTop();
      if (elegida) abrirTarjeta(elegida);
      const dato = estaciones[0]?.actualizado?.slice(11, 16);
      $('actualizado').textContent = `Dato de SIATA: ${dato || '—'} · se actualiza solo cada 5 min`;
    } catch (err) {
      if (!estaciones.length) $('titular').textContent = 'No pude traer los datos de SIATA';
      aviso('SIATA no respondió. Vuelvo a intentar en un momento.');
    }
  }

  // ---------- radar ----------
  const rc = { cuadros: [], i: 0, play: true, timer: null, capa: null, limites: null };

  async function prenderRadar() {
    const b = $('btn-radar');
    b.disabled = true;
    try {
      const r = await fetch('/api/radar');
      const j = await r.json();
      if (!r.ok || !j.cuadros?.length) {
        aviso('El radar de SIATA no tiene imágenes de las últimas 2 horas (puede estar en mantenimiento).');
        return false;
      }
      rc.cuadros = j.cuadros;
      rc.limites = j.limites;
      rc.cuadros.forEach((c) => { new Image().src = c.url; }); // precarga
      if (!rc.capa) rc.capa = L.imageOverlay(rc.cuadros.at(-1).url, rc.limites, { opacity: 0.75, zIndex: 400 });
      rc.capa.addTo(mapa);
      $('radar-barra').max = rc.cuadros.length - 1;
      rc.i = rc.cuadros.length - 1;
      mostrarCuadro();
      $('radar-control').hidden = false;
      if (rc.cuadros.length < 3) aviso('El radar solo tiene ' + rc.cuadros.length + ' imágenes recientes.');
      if (rc.play) iniciarAnimacion();
      return true;
    } catch {
      aviso('No pude cargar el radar.');
      return false;
    } finally {
      b.disabled = false;
    }
  }
  function mostrarCuadro() {
    const c = rc.cuadros[rc.i];
    rc.capa.setUrl(c.url);
    $('radar-barra').value = rc.i;
    const ultimo = rc.i === rc.cuadros.length - 1;
    $('radar-hora').textContent = hora(new Date(c.hora)) + (ultimo ? ' ●' : '');
  }
  function iniciarAnimacion() {
    clearInterval(rc.timer);
    rc.timer = setInterval(() => {
      // Se queda un poco más en la imagen más reciente
      if (rc.i === rc.cuadros.length - 1 && (rc.pausa = (rc.pausa || 0) + 1) < 3) return;
      rc.pausa = 0;
      rc.i = (rc.i + 1) % rc.cuadros.length;
      mostrarCuadro();
    }, 600);
    $('radar-play').textContent = '❚❚';
    $('radar-play').setAttribute('aria-label', 'Pausar');
  }
  function pausar() {
    clearInterval(rc.timer);
    $('radar-play').textContent = '▶';
    $('radar-play').setAttribute('aria-label', 'Reproducir');
  }
  $('radar-play').addEventListener('click', () => { rc.play = !rc.play; rc.play ? iniciarAnimacion() : pausar(); });
  $('radar-barra').addEventListener('input', (ev) => { rc.play = false; pausar(); rc.i = +ev.target.value; mostrarCuadro(); });
  $('btn-radar').addEventListener('click', async () => {
    const b = $('btn-radar');
    if (b.getAttribute('aria-pressed') === 'true') {
      b.setAttribute('aria-pressed', 'false');
      pausar();
      rc.capa && mapa.removeLayer(rc.capa);
      $('radar-control').hidden = true;
      guardar('radar', '0');
    } else if (await prenderRadar()) {
      b.setAttribute('aria-pressed', 'true');
      guardar('radar', '1');
      if (mapa.getZoom() > 11) mapa.flyTo([6.25, -75.57], 10, { duration: 0.8 });
    }
  });

  // ---------- cerca de mí ----------
  let yo = null;
  const distKm = (a, b, c, d) => {
    const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r;
    return Math.sqrt(x * x + y * y) * 6371;
  };
  $('btn-cerca').addEventListener('click', () => {
    if (!navigator.geolocation) return aviso('Tu navegador no permite ubicarte.');
    $('btn-cerca').disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      $('btn-cerca').disabled = false;
      const { latitude: la, longitude: lo } = pos.coords;
      if (yo) mapa.removeLayer(yo);
      yo = L.marker([la, lo], { icon: L.divIcon({ className: '', html: '<div class="yo"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), pane: 'estaciones', zIndexOffset: 99999 }).addTo(mapa);
      const cerca = estaciones.map((e) => ({ e, d: distKm(la, lo, e.lat, e.lon) })).sort((a, b) => a.d - b.d).slice(0, 3);
      if (!cerca.length || cerca[0].d > 25) {
        mapa.flyTo([la, lo], 11);
        return aviso('Estás lejos del Valle de Aburrá: aquí no hay pluviómetros de SIATA. Mira el pronóstico.', 7000);
      }
      mapa.flyTo([la, lo], 14, { duration: 0.8 });
      const llueve = cerca.filter((c) => (c.e.mm.m30 || 0) > 0);
      aviso(llueve.length
        ? `Está lloviendo cerca de ti: ${bonito(llueve[0].e.nombre)} (a ${llueve[0].d.toFixed(1)} km), ${fmt(llueve[0].e.mm.m30)} mm en 30 min.`
        : `No llueve cerca de ti. Estación más cercana: ${bonito(cerca[0].e.nombre)}, a ${cerca[0].d.toFixed(1)} km.`, 8000);
      abrirTarjeta(cerca[0].e);
    }, () => {
      $('btn-cerca').disabled = false;
      aviso('No pude saber tu ubicación. Revisa el permiso del navegador.');
    }, { enableHighAccuracy: true, timeout: 10000 });
  });

  // ---------- pronóstico ----------
  let pron = null;
  let dia = 0;
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  async function cargarPronostico() {
    try {
      const r = await fetch('/api/pronostico');
      pron = await r.json();
      if (!r.ok) throw new Error();
      pintarPronostico();
    } catch {
      $('pron-titular').textContent = 'No pude traer el pronóstico';
    }
  }
  function pintarPronostico() {
    if (!pron) return;
    const zonas = pron.zonas.filter((z) => z.dias[dia]);
    const valle = zonas.filter((z) => !z.fuera);
    const fecha = valle[0]?.dias[dia]?.fecha || zonas[0]?.dias[dia]?.fecha;
    if (fecha) {
      document.querySelector('#dias [data-d="1"]').textContent = 'Mañana ' + DIAS[(new Date().getDay() + 1) % 7];
      const conAlta = (franja) => valle.filter((z) => z.dias[dia].lluvia[franja] === 'ALTA').length;
      const nombresF = ['la madrugada', 'la mañana', 'la tarde', 'la noche'];
      const peor = [0, 1, 2, 3].sort((a, b) => conAlta(b) - conAlta(a))[0];
      const media = [0, 1, 2, 3].filter((f) => valle.some((z) => z.dias[dia].lluvia[f] !== 'BAJA'));
      const cuando = dia === 0 ? 'Hoy' : 'Mañana';
      $('pron-titular').innerHTML = conAlta(peor)
        ? `${cuando} es muy probable que llueva en <em>${nombresF[peor]}</em>`
        : media.length
          ? `${cuando} puede llover en <em>${nombresF[media[0]]}</em>${media.length > 1 ? ' y ' + nombresF[media.at(-1)] : ''}`
          : `${cuando} se espera un día seco en el valle`;
    }
    $('zonas').innerHTML = zonas.map((z) => {
      const d = z.dias[dia];
      return `<li class="${z.fuera ? 'fuera' : ''}">
        <span class="zona">${esc(z.nombre)}${z.fuera ? `<small>fuera del valle · ${esc(z.fuente)}${d.mm != null ? ' · ' + fmt(d.mm) + ' mm' : ''}</small>` : ''}</span>
        ${d.lluvia.map((p, i) => `<span class="franja p-${esc(p)}" title="${['Madrugada', 'Mañana', 'Tarde', 'Noche'][i]}: ${p === 'ALTA' ? 'muy probable' : p === 'MEDIA' ? 'puede llover' : 'poco probable'}"></span>`).join('')}
        <span class="temp"><b>${d.max ?? '—'}</b>/${d.min ?? '—'}</span>
      </li>`;
    }).join('');
    const emitido = valle[0]?.emitido;
    $('pron-actualizado').textContent = emitido ? `Pronóstico WRF de SIATA emitido ${emitido.slice(11)} del ${emitido.slice(8, 10)}/${emitido.slice(5, 7)}` : '';
  }
  document.querySelectorAll('#dias button').forEach((b) => b.addEventListener('click', () => {
    dia = +b.dataset.d;
    document.querySelectorAll('#dias button').forEach((x) => x.classList.toggle('activo', x === b));
    pintarPronostico();
  }));

  // ---------- pestañas ----------
  function elegirVista(v) {
    document.querySelectorAll('.pestana').forEach((b) => {
      const on = b.dataset.vista === v;
      b.classList.toggle('activa', on);
      b.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('.vista').forEach((s) => s.classList.toggle('activa', s.id === 'vista-' + v));
    guardar('vista', v);
  }
  document.querySelectorAll('.pestana').forEach((b) => b.addEventListener('click', () => elegirVista(b.dataset.vista)));

  // ---------- arranque ----------
  elegirVista(leer('vista') === 'pronostico' ? 'pronostico' : 'ahora');
  elegirPeriodo(periodo);
  cargarLluvia();
  cargarPronostico();
  if (leer('radar') === '1') $('btn-radar').click();
  setInterval(() => {
    cargarLluvia();
    if ($('btn-radar').getAttribute('aria-pressed') === 'true') prenderRadar();
  }, 5 * 60 * 1000);
  setInterval(cargarPronostico, 30 * 60 * 1000);
})();
