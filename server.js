// Analizador de imágenes con IA — servidor local.
// Sirve la página (carpeta public/) y hace de intermediario con la API de Gemini,
// así la API key queda en esta PC y nunca llega al navegador.
// Sin dependencias: Node 24 trae http y fetch.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(RAIZ, 'public');

export const MAX_IMAGENES = 9;
// Gemini limita el pedido con imágenes incrustadas a 20 MB en total.
const MAX_CUERPO = 19 * 1024 * 1024;
const TIPOS_IMAGEN = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/avif']);
// Modelos estables de Gemini con nivel gratuito (verificado en la doc de Google el 24/11/2026).
export const MODELOS = [
  { id: 'gemini-3.8-flash', nombre: 'Gemini 3.8 Flash (más preciso)' },
  { id: 'gemini-3.6-flash', nombre: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash-lite', nombre: 'Gemini 3.5 Flash-Lite (más rápido)' },
];

const TIPOS_ARCHIVO = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const INSTRUCCION =
  'Vas a recibir varias imágenes numeradas (Imagen 1, Imagen 2, ...). ' +
  'Analizalas en conjunto, como si fueran una sola composición, y respondé el pedido del usuario. ' +
  'Cuando hables de una imagen puntual, nombrala por su número. ' +
  'Respondé en español rioplatense, claro y ordenado. Si algo no se puede saber con lo que se ve, decilo.';

function responderJson(res, estado, datos) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(cuerpo);
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    const partes = [];
    let total = 0;
    req.on('data', (trozo) => {
      total += trozo.length;
      if (total > MAX_CUERPO) {
        rechazar(Object.assign(new Error('Las imágenes pesan demasiado (máximo 19 MB en total).'), { estado: 413 }));
        req.destroy();
        return;
      }
      partes.push(trozo);
    });
    req.on('end', () => resolver(Buffer.concat(partes).toString('utf8')));
    req.on('error', rechazar);
  });
}

// Valida lo que manda la página. Devuelve un texto de error o null.
export function validarPedido(p) {
  if (!p || typeof p !== 'object') return 'Pedido inválido.';
  if (typeof p.prompt !== 'string' || !p.prompt.trim()) return 'Escribí qué querés que analice la IA.';
  if (p.prompt.length > 8000) return 'El texto del pedido es demasiado largo (máximo 8000 caracteres).';
  if (!Array.isArray(p.imagenes) || p.imagenes.length === 0) return 'Cargá al menos una imagen.';
  if (p.imagenes.length > MAX_IMAGENES) return `Se pueden analizar hasta ${MAX_IMAGENES} imágenes juntas.`;
  for (const [i, img] of p.imagenes.entries()) {
    if (!img || !TIPOS_IMAGEN.has(img.mimeType)) return `La imagen ${i + 1} no tiene un formato admitido.`;
    if (typeof img.data !== 'string' || !img.data || !/^[A-Za-z0-9+/=]+$/.test(img.data)) return `La imagen ${i + 1} llegó dañada.`;
  }
  if (p.modelo && !MODELOS.some((m) => m.id === p.modelo)) return 'Modelo no admitido.';
  return null;
}

// Arma el cuerpo de generateContent: cada imagen va precedida de su número.
export function armarCuerpoGemini(p) {
  const partes = [{ text: INSTRUCCION }];
  p.imagenes.forEach((img, i) => {
    partes.push({ text: `Imagen ${i + 1}${img.nombre ? ` (${String(img.nombre).slice(0, 120)})` : ''}:` });
    partes.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  });
  partes.push({ text: `Pedido del usuario:\n${p.prompt.trim()}` });
  return { contents: [{ role: 'user', parts: partes }] };
}

export function extraerTexto(respuesta) {
  const candidato = respuesta?.candidates?.[0];
  const texto = (candidato?.content?.parts || []).map((x) => x.text || '').join('').trim();
  if (texto) return { texto, motivo: candidato?.finishReason || null };
  const bloqueo = respuesta?.promptFeedback?.blockReason;
  if (bloqueo) return { error: `La IA rechazó el pedido (motivo: ${bloqueo}).` };
  if (candidato?.finishReason) return { error: `La IA no devolvió texto (motivo: ${candidato.finishReason}).` };
  return { error: 'La IA no devolvió ninguna respuesta.' };
}

async function analizar(req, res, cfg) {
  if (!cfg.apiKey) {
    return responderJson(res, 500, { error: 'Falta la API key de Gemini. Cargala en el archivo .env (ver LEEME.md) y reiniciá el programa.' });
  }
  let pedido;
  try {
    pedido = JSON.parse(await leerCuerpo(req));
  } catch (e) {
    return responderJson(res, e.estado || 400, { error: e.estado ? e.message : 'Pedido inválido.' });
  }
  const error = validarPedido(pedido);
  if (error) return responderJson(res, 400, { error });

  const modelo = pedido.modelo || cfg.modelo;
  const url = `${cfg.baseUrl}/models/${encodeURIComponent(modelo)}:generateContent`;
  const inicio = Date.now();
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify(armarCuerpoGemini(pedido)),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    const msj = e.name === 'TimeoutError' ? 'La IA tardó demasiado en responder. Probá de nuevo.' : 'No se pudo conectar con Gemini. Revisá la conexión a internet.';
    return responderJson(res, 502, { error: msj });
  }
  let datos = null;
  try { datos = await r.json(); } catch { /* respuesta sin JSON */ }
  if (!r.ok) {
    const detalle = datos?.error?.message || `HTTP ${r.status}`;
    const ayuda = r.status === 429 ? ' Se alcanzó el límite de uso de la API: esperá un rato y probá de nuevo.'
      : (r.status === 400 || r.status === 403) && /api key/i.test(detalle) ? ' Revisá que la API key sea correcta.'
      : r.status === 404 ? ' Puede que el modelo elegido ya no exista: probá con otro.' : '';
    return responderJson(res, 502, { error: `Gemini respondió con error: ${detalle}.${ayuda}` });
  }
  const resultado = extraerTexto(datos);
  if (resultado.error) return responderJson(res, 502, { error: resultado.error });
  responderJson(res, 200, {
    texto: resultado.texto,
    cortado: resultado.motivo === 'MAX_TOKENS',
    modelo,
    segundos: Math.round((Date.now() - inicio) / 100) / 10,
    tokens: datos?.usageMetadata?.totalTokenCount ?? null,
  });
}

async function servirArchivo(req, res) {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const relativo = ruta === '/' ? 'index.html' : ruta.slice(1);
  const archivo = path.resolve(PUBLICO, relativo);
  if (!archivo.startsWith(PUBLICO + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const contenido = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS_ARCHIVO[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(contenido);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}

export function crearServidor(opciones = {}) {
  const cfg = {
    apiKey: opciones.apiKey ?? process.env.GEMINI_API_KEY ?? '',
    modelo: opciones.modelo ?? process.env.GEMINI_MODEL ?? MODELOS[0].id,
    baseUrl: opciones.baseUrl ?? process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta',
  };
  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://x');
      if (pathname === '/api/config' && req.method === 'GET') {
        return responderJson(res, 200, { tieneKey: Boolean(cfg.apiKey), modelo: cfg.modelo, modelos: MODELOS, maxImagenes: MAX_IMAGENES });
      }
      if (pathname === '/api/analizar') {
        if (req.method !== 'POST') return responderJson(res, 405, { error: 'Método no permitido.' });
        return await analizar(req, res, cfg);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return responderJson(res, 405, { error: 'Método no permitido.' });
      return await servirArchivo(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) responderJson(res, 500, { error: 'Error interno del programa.' });
    }
  });
}

// Arranque directo: node server.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(path.join(RAIZ, '.env')); } catch { /* sin .env: se usan las variables de entorno */ }
  const puerto = Number(process.env.PORT) || 3020;
  crearServidor().listen(puerto, '127.0.0.1', () => {
    console.log(`Analizador de imágenes IA en http://localhost:${puerto}`);
    if (!process.env.GEMINI_API_KEY) console.log('Atención: falta GEMINI_API_KEY (ver LEEME.md).');
  });
}
