import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { crearServidor, validarPedido, armarCuerpoGemini, extraerTexto } from '../server.js';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const img = (n = 'a.png') => ({ nombre: n, mimeType: 'image/png', data: PIXEL });

let falso, app, base, ultimo, respuestaFalsa;
const escuchar = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

before(async () => {
  // Servidor que imita a Gemini y guarda el último pedido
  falso = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      ultimo = { url: req.url, key: req.headers['x-goog-api-key'], cuerpo: JSON.parse(b) };
      const [estado, datos] = respuestaFalsa;
      res.writeHead(estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(datos));
    });
  });
  const urlFalsa = await escuchar(falso);
  app = crearServidor({ apiKey: 'clave-de-prueba', modelo: 'gemini-3.8-flash', baseUrl: urlFalsa });
  base = await escuchar(app);
});
after(() => { app.close(); falso.close(); });

const post = (cuerpo) => fetch(`${base}/api/analizar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

test('validación del pedido', () => {
  assert.match(validarPedido({ prompt: '', imagenes: [img()] }), /Escribí/);
  assert.match(validarPedido({ prompt: 'x', imagenes: [] }), /al menos una/);
  assert.match(validarPedido({ prompt: 'x', imagenes: Array(10).fill(img()) }), /hasta 9/);
  assert.match(validarPedido({ prompt: 'x', imagenes: [{ mimeType: 'text/plain', data: 'aa' }] }), /formato/);
  assert.match(validarPedido({ prompt: 'x', imagenes: [img()], modelo: 'otro' }), /Modelo/);
  assert.equal(validarPedido({ prompt: 'x', imagenes: Array(9).fill(img()) }), null);
});

test('arma las partes numeradas con el pedido al final', () => {
  const c = armarCuerpoGemini({ prompt: ' ¿qué ves? ', imagenes: [img('uno.png'), img('dos.png')] });
  const p = c.contents[0].parts;
  assert.equal(p[1].text, 'Imagen 1 (uno.png):');
  assert.deepEqual(p[2].inlineData, { mimeType: 'image/png', data: PIXEL });
  assert.equal(p[3].text, 'Imagen 2 (dos.png):');
  assert.equal(p.at(-1).text, 'Pedido del usuario:\n¿qué ves?');
});

test('extrae el texto o explica por qué no hay', () => {
  assert.equal(extraerTexto({ candidates: [{ content: { parts: [{ text: 'Hola ' }, { text: 'mundo' }] } }] }).texto, 'Hola mundo');
  assert.match(extraerTexto({ promptFeedback: { blockReason: 'SAFETY' } }).error, /SAFETY/);
  assert.match(extraerTexto({}).error, /ninguna/);
});

test('reenvía a Gemini y devuelve la conclusión', async () => {
  respuestaFalsa = [200, { candidates: [{ content: { parts: [{ text: 'Son 3 mochilas.' }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 1234 } }];
  const r = await post({ prompt: 'Contá', modelo: 'gemini-3.6-flash', imagenes: [img(), img(), img()] });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.texto, 'Son 3 mochilas.');
  assert.equal(d.tokens, 1234);
  assert.equal(ultimo.url, '/models/gemini-3.6-flash:generateContent');
  assert.equal(ultimo.key, 'clave-de-prueba');
  assert.equal(ultimo.cuerpo.contents[0].parts.filter((p) => p.inlineData).length, 3);
});

test('traduce errores de Gemini', async () => {
  respuestaFalsa = [429, { error: { message: 'Resource exhausted' } }];
  const r = await post({ prompt: 'x', imagenes: [img()] });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /límite de uso/);
});

test('rechaza pedidos inválidos sin llamar a Gemini', async () => {
  ultimo = null;
  const r = await post({ prompt: 'x', imagenes: Array(10).fill(img()) });
  assert.equal(r.status, 400);
  assert.equal(ultimo, null);
});

test('no expone la key en /api/config y no sale de public/', async () => {
  const c = await (await fetch(`${base}/api/config`)).json();
  assert.equal(c.tieneKey, true);
  assert.ok(!JSON.stringify(c).includes('clave-de-prueba'));
  const r = await fetch(`${base}/..%2Fserver.js`);
  assert.notEqual(r.status, 200);
});

test('sin key avisa con un mensaje claro', async () => {
  const sin = crearServidor({ apiKey: '', baseUrl: 'http://127.0.0.1:1' });
  const b = await escuchar(sin);
  const r = await fetch(`${b}/api/analizar`, { method: 'POST', body: '{}' });
  assert.match((await r.json()).error, /API key/);
  sin.close();
});
