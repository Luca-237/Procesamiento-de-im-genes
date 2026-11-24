# Analizador de imágenes IA

Programa web que junta hasta **9 imágenes** y le pide a la IA de Google (**Gemini**) una sola conclusión sobre todas, a partir de un pedido escrito en un cuadro de texto.

- En pantalla las fotos se ven como un **collage** (1x1, 2x1, 2x2, 3x2 o 3x3 según la cantidad), numeradas, y se puede **descargar** como JPG.
- A la IA le llegan las fotos **por separado y numeradas, en un solo pedido** ("Imagen 1", "Imagen 2"...). Así las analiza juntas sin perder detalle (un collage único dejaría cada foto en unos 500 px).
- Antes de mandarlas, el navegador las achica a 1600 px de lado mayor (JPEG): 9 fotos entran cómodas en el límite de 20 MB de Gemini.
- La API key queda en esta PC (archivo `.env`), nunca llega al navegador.

## Primera vez
1. Crear una API key de Gemini en Google AI Studio (aistudio.google.com, "Get API key").
2. En esta carpeta, copiar `.env.example` como `.env` y pegar la key en `GEMINI_API_KEY=`.
   El `.env` está en `.gitignore`: no se sube a git. No pegar la key en el chat ni en el vault.
3. Necesita Node 21.7 o más nuevo (esta PC tiene Node 24). No hay que instalar paquetes.

## Usarlo
- Doble clic en `iniciar.bat` (abre http://localhost:3020), o `npm start`.
- Cargar fotos: arrastrarlas, hacer clic en el recuadro o pegarlas con Ctrl+V. Arrastrar una sobre otra cambia el orden.
- Escribir el pedido (o tocar un ejemplo) y **Analizar** (o Ctrl+Enter).
- Arriba a la derecha se elige el modelo: Gemini 3.8 Flash (más preciso, por defecto), 3.6 Flash o 3.5 Flash-Lite (más rápido).

## Probar sin API key
`npm run demo` levanta el programa en http://localhost:3021 con una Gemini "de mentira" que contesta un texto fijo.

## Pruebas
`npm test` (8 pruebas: validación, armado del pedido a Gemini, errores, que la key no se exponga).

## Importante
- **Nivel gratuito de Gemini:** Google puede usar lo que se manda para mejorar sus productos. No subir fotos con datos sensibles (documentos, datos de clientes) mientras se use la key gratuita.
- Límites: si aparece "límite de uso", esperar un rato. Si un modelo deja de existir, elegir otro en la lista (`MODELOS` en `server.js`).
- El servidor escucha solo en `127.0.0.1`: no es accesible desde otras PCs de la red.

## Archivos
- `server.js`: servidor local (Node sin dependencias). `GET /api/config`, `POST /api/analizar` → `generateContent` de Gemini con header `x-goog-api-key`.
- `public/`: la página (HTML/CSS/JS sin frameworks, íconos SVG estilo Lucide, estilo Cindy con modo oscuro).
- `scripts/demo.js`: modo demo. `pruebas/`: pruebas con `node --test`.
