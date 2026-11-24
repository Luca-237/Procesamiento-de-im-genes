// Modo demo: levanta el programa con una "Gemini de mentira" local que contesta un texto fijo.
// Sirve para probar la pantalla sin API key y sin gastar cuota. Uso: npm run demo
import http from 'node:http';
import { crearServidor } from '../server.js';

const falsa = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    const partes = JSON.parse(cuerpo).contents[0].parts;
    const n = partes.filter((p) => p.inlineData).length;
    const pedido = partes.at(-1).text.replace('Pedido del usuario:\n', '');
    const texto = `## Respuesta de prueba (modo demo)\n\nRecibí **${n} imágenes** y este pedido:\n\n- ${pedido}\n\nEn el modo real, acá aparece la conclusión de Gemini.`;
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 258 * n + 40 } }));
    }, 800);
  });
});

falsa.listen(0, '127.0.0.1', () => {
  const baseUrl = `http://127.0.0.1:${falsa.address().port}`;
  const puerto = Number(process.env.PORT) || 3021;
  crearServidor({ apiKey: 'demo', baseUrl }).listen(puerto, '127.0.0.1', () => console.log(`Modo demo en http://localhost:${puerto}`));
});
