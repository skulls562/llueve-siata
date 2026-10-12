// ¿Llueve? — servidor pequeño: sirve la página y limpia los datos de SIATA.
// Uso: node server.js  →  http://localhost:5173
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5173;
const SIATA = 'https://siata.gov.co';
const CAPA_PLUVIO = 'C_00000000000000000000210';
const ZONAS = {
  barbosa: 'Barbosa', girardota: 'Girardota', copacabana: 'Copacabana', bello: 'Bello',
  medOccidente: 'Medellín occidente', medCentro: 'Medellín centro', medOriente: 'Medellín oriente',
  palmitas: 'Palmitas', itagui: 'Itagüí', envigado: 'Envigado', sabaneta: 'Sabaneta',
  laestrella: 'La Estrella', caldas: 'Caldas',
};

// ---------- utilidades ----------
async function pedir(url, { method = 'GET', body = null, timeout = 60000 } = {}) {
  const res = await fetch(url, {
    method,
    body,
    headers: {
      'User-Agent': 'Mozilla/5.0 (llueve local)',
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.text();
}

// Caché simple: devuelve lo guardado si está fresco; si no, refresca.
// Si SIATA falla, devuelve lo último que tenga.
function cache(ms, fn) {
  let valor = null, cuando = 0, enCurso = null;
  return async () => {
    if (valor && Date.now() - cuando < ms) return valor;
    if (!enCurso) {
      enCurso = fn().then((v) => { valor = v; cuando = Date.now(); return v; })
        .finally(() => { enCurso = null; });
    }
    try { return await enCurso; } catch (e) { if (valor) return valor; throw e; }
  };
}

const num = (txt) => {
  const n = parseFloat(String(txt ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const attr = (grupo, clave) => {
  const a = grupo?.[clave];
  return a ? (a.valor_alfanumerico ?? a.valor_numerico ?? a.valor_fecha ?? '') : '';
};
const limpio = (t) => String(t || '').replace(/\s+/g, ' ').trim();

// ---------- lluvia ----------
const lluvia = cache(3 * 60 * 1000, async () => {
  const texto = await pedir(`${SIATA}/siata_nuevo/index.php/capa_service/consultar_capa_carga`, {
    method: 'POST', body: `id_capa=${CAPA_PLUVIO}`, timeout: 90000,
  });
  const datos = JSON.parse(texto.slice(texto.indexOf('{')));
  const estaciones = (datos.feature_vector || []).map((f) => {
    const g = JSON.parse(f.geometry_text);
    const d = f.atributos.descripcion || {};
    const gr = f.atributos.grafico || {};
    const md = f.atributos.metadato || {};
    const gal = f.atributos.galeria || {};
    const lugar = [attr(d, 'Comuna') || attr(d, 'Vereda') || attr(d, 'Barrio'), attr(d, 'Municipio')]
      .map(limpio).filter(Boolean);
    return {
      id: limpio(attr(d, 'Codigo')),
      nombre: limpio(attr(md, 'name')),
      lugar: [...new Set(lugar)].join(', '),
      municipio: limpio(attr(d, 'Municipio')),
      cuenca: limpio(attr(d, 'Subcuenca')),
      lat: g.coordinates[1],
      lon: g.coordinates[0],
      actualizado: limpio(attr(d, 'fecha_ultima_actualizacion')), // hora de Colombia
      mm: {
        m5: num(attr(d, 'D_5_m')),
        m30: num(attr(d, 'D_30_m')),
        h1: num(attr(d, 'D_1_H')),
        h3: num(attr(d, 'D_3_H')),
        h24: num(attr(d, 'D_24_H')),
        h72: num(attr(d, 'D_72_H')),
        d30: num(attr(d, 'D_30_D')),
      },
      graficas: {
        h3: limpio(attr(gr, 'G_3_H_P')),
        h24: limpio(attr(gr, 'G_24_H_P')),
        h72: limpio(attr(gr, 'G_72_H_P')),
        d30: limpio(attr(gr, 'G_30_D_P')),
      },
      foto: limpio(attr(gal, 'url_imagen')),
    };
  }).filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon));
  return { generado: new Date().toISOString(), estaciones };
});

// ---------- radar ----------
// Las imágenes están en /data/radar/10/AAAAMMDD/AAAAMMDDhhmm.png (hora UTC), cada 5 min.
const fechaUTC = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const radar = cache(2 * 60 * 1000, async () => {
  const ahora = new Date();
  const dias = [fechaUTC(new Date(ahora - 86400000)), fechaUTC(ahora)];
  let cuadros = [];
  for (const dia of dias) {
    try {
      const html = await pedir(`${SIATA}/data/radar/10/${dia}/`, { timeout: 30000 });
      const nombres = [...new Set(html.match(/\d{12}\.png/g) || [])];
      cuadros.push(...nombres.map((n) => ({ dia, n })));
    } catch { /* el día puede no existir aún */ }
  }
  cuadros.sort((a, b) => a.n.localeCompare(b.n));
  const limite = Date.now() - 2 * 3600 * 1000;
  cuadros = cuadros.map(({ dia, n }) => {
    const t = Date.UTC(+n.slice(0, 4), +n.slice(4, 6) - 1, +n.slice(6, 8), +n.slice(8, 10), +n.slice(10, 12));
    return { hora: new Date(t).toISOString(), url: `${SIATA}/data/radar/10/${dia}/${n}` };
  }).filter((c) => Date.parse(c.hora) >= limite);
  return { limites: [[5.1, -76.6], [7.3, -74.3]], cuadros };
});

// ---------- pronóstico ----------
const pronostico = cache(30 * 60 * 1000, async () => {
  const zonas = await Promise.all(Object.entries(ZONAS).map(async ([clave, nombre]) => {
    try {
      const j = JSON.parse(await pedir(`${SIATA}/data/siata_app/wrf${clave}.json`, { timeout: 20000 }));
      return {
        clave, nombre, emitido: j.date,
        dias: (j.pronostico || []).map((p) => ({
          fecha: p.fecha,
          max: num(p.temperatura_maxima), min: num(p.temperatura_minima),
          lluvia: [p.lluvia_madrugada, p.lluvia_mannana, p.lluvia_tarde, p.lluvia_noche].map((v) => limpio(v).toUpperCase()),
        })),
      };
    } catch { return { clave, nombre, dias: [] }; }
  }));
  // Fuera del valle: SIATA no pronostica el Oriente, así que se usa Open-Meteo (gratis, sin clave).
  const externas = await Promise.all(EXTERNAS.map(pronosticoOpenMeteo));
  return { zonas: [...zonas, ...externas] };
});

const EXTERNAS = [{ clave: 'marinilla', nombre: 'Marinilla', lat: 6.1737, lon: -75.3356 }];
const nivel = (p) => (p == null ? '' : p >= 60 ? 'ALTA' : p >= 30 ? 'MEDIA' : 'BAJA');
async function pronosticoOpenMeteo({ clave, nombre, lat, lon }) {
  try {
    const j = JSON.parse(await pedir(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + '&hourly=precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_sum'
      + '&timezone=America/Bogota&forecast_days=2', { timeout: 20000 }));
    const dias = j.daily.time.map((fecha, i) => {
      // Probabilidad máxima de lluvia en cada franja: madrugada, mañana, tarde, noche.
      const franjas = [0, 6, 12, 18].map((desde) => {
        const ps = j.hourly.time
          .map((t, k) => (t.startsWith(fecha) && +t.slice(11, 13) >= desde && +t.slice(11, 13) < desde + 6 ? j.hourly.precipitation_probability[k] : null))
          .filter((p) => p != null);
        return nivel(ps.length ? Math.max(...ps) : null);
      });
      return {
        fecha,
        max: Math.round(j.daily.temperature_2m_max[i]), min: Math.round(j.daily.temperature_2m_min[i]),
        lluvia: franjas, mm: j.daily.precipitation_sum[i],
      };
    });
    return { clave, nombre, fuente: 'Open-Meteo', fuera: true, dias };
  } catch { return { clave, nombre, fuente: 'Open-Meteo', fuera: true, dias: [] }; }
}

// ---------- servidor ----------
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const RUTAS = { '/api/lluvia': lluvia, '/api/radar': radar, '/api/pronostico': pronostico };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (RUTAS[url.pathname]) {
    try {
      const datos = await RUTAS[url.pathname]();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(datos));
    } catch (e) {
      console.error(e.message);
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'SIATA no respondió. Intenta en un momento.' }));
    }
    return;
  }
  const archivo = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!archivo.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(archivo, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`¿Llueve? listo en http://localhost:${PORT}`);
  lluvia().catch(() => {}); // calienta la caché
});
