// Analizador de imágenes IA — lógica de la página.
// Las fotos se achican en el navegador (lado mayor 1600 px, JPEG) antes de mandarlas,
// para que 9 fotos entren cómodas en el límite de 20 MB de Gemini sin perder detalle útil.
(() => {
  'use strict';

  const LADO_MAX = 1600;
  const CALIDAD = 0.88;
  let MAX = 9;
  const imagenes = []; // { id, nombre, mimeType, data, url, img }
  let ultimaRespuesta = '';
  let enviando = false;

  const $ = (id) => document.getElementById(id);
  const el = {
    modelo: $('modelo'), avisoKey: $('aviso-key'), collage: $('collage'), contador: $('contador'),
    zona: $('zona'), archivo: $('archivo'), prompt: $('prompt'), ejemplos: $('ejemplos'),
    analizar: $('btn-analizar'), descargar: $('btn-descargar'), vaciar: $('btn-vaciar'), copiar: $('btn-copiar'),
    resultado: $('resultado'), cargando: $('cargando'), error: $('error'), respuesta: $('respuesta'), meta: $('meta'),
    toast: $('toast'),
  };

  // ---------- Avisos ----------
  let toastTimer;
  function avisar(texto) {
    el.toast.textContent = texto;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  // ---------- Configuración del servidor ----------
  async function cargarConfig() {
    try {
      const r = await fetch('/api/config');
      const c = await r.json();
      MAX = c.maxImagenes || 9;
      el.modelo.innerHTML = '';
      for (const m of c.modelos) {
        const o = document.createElement('option');
        o.value = m.id; o.textContent = m.nombre;
        if (m.id === c.modelo) o.selected = true;
        el.modelo.append(o);
      }
      try { const guardado = localStorage.getItem('analizador.modelo'); if (guardado && c.modelos.some((m) => m.id === guardado)) el.modelo.value = guardado; } catch { /* sin almacenamiento */ }
      el.avisoKey.hidden = c.tieneKey;
    } catch {
      avisar('No se pudo leer la configuración del programa.');
    }
  }
  el.modelo.addEventListener('change', () => { try { localStorage.setItem('analizador.modelo', el.modelo.value); } catch { /* nada */ } });

  // ---------- Carga y preparación de imágenes ----------
  function cargarElementoImagen(url) {
    return new Promise((resolver, rechazar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = () => rechazar(new Error('No se pudo leer la imagen'));
      img.src = url;
    });
  }

  async function prepararArchivo(archivo) {
    const original = URL.createObjectURL(archivo);
    try {
      const img = await cargarElementoImagen(original);
      const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * escala));
      const h = Math.max(1, Math.round(img.naturalHeight * escala));
      const lienzo = document.createElement('canvas');
      lienzo.width = w; lienzo.height = h;
      const ctx = lienzo.getContext('2d');
      ctx.fillStyle = '#fff'; // las transparencias quedan sobre blanco
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = lienzo.toDataURL('image/jpeg', CALIDAD);
      const final = await cargarElementoImagen(dataUrl);
      return { id: crypto.randomUUID(), nombre: archivo.name || 'imagen pegada', mimeType: 'image/jpeg', data: dataUrl.split(',')[1], url: dataUrl, img: final };
    } finally {
      URL.revokeObjectURL(original);
    }
  }

  async function agregarArchivos(lista) {
    const archivos = [...lista].filter((f) => f.type.startsWith('image/'));
    if (!archivos.length) { avisar('Eso no es una imagen.'); return; }
    const lugar = MAX - imagenes.length;
    if (lugar <= 0) { avisar(`Ya hay ${MAX} imágenes, el máximo.`); return; }
    if (archivos.length > lugar) avisar(`Solo entraban ${lugar} más: se cargaron las primeras.`);
    for (const f of archivos.slice(0, lugar)) {
      try { imagenes.push(await prepararArchivo(f)); }
      catch { avisar(`No se pudo abrir "${f.name}". Si es HEIC, pasala a JPG.`); }
      dibujar();
    }
  }

  // ---------- Collage en pantalla ----------
  function dibujar() {
    el.collage.innerHTML = '';
    el.collage.dataset.cant = String(imagenes.length);
    imagenes.forEach((im, i) => {
      const celda = document.createElement('div');
      celda.className = 'celda';
      celda.draggable = true;
      celda.dataset.indice = String(i);
      celda.title = im.nombre;
      const img = document.createElement('img');
      img.src = im.url; img.alt = `Imagen ${i + 1}: ${im.nombre}`;
      const num = document.createElement('span');
      num.className = 'numero'; num.textContent = String(i + 1);
      const quitar = document.createElement('button');
      quitar.type = 'button'; quitar.className = 'quitar'; quitar.setAttribute('aria-label', `Quitar imagen ${i + 1}`);
      quitar.innerHTML = '<svg class="ico" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      quitar.addEventListener('click', () => { imagenes.splice(i, 1); dibujar(); });
      celda.append(img, num, quitar);
      conectarArrastre(celda);
      el.collage.append(celda);
    });
    el.contador.textContent = `${imagenes.length} / ${MAX}`;
    el.zona.classList.toggle('llena', imagenes.length >= MAX);
    el.descargar.disabled = el.vaciar.disabled = imagenes.length === 0;
    actualizarBoton();
  }

  let origen = null;
  function conectarArrastre(celda) {
    celda.addEventListener('dragstart', (e) => { origen = Number(celda.dataset.indice); celda.classList.add('arrastrando'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'reordenar'); });
    celda.addEventListener('dragend', () => { origen = null; celda.classList.remove('arrastrando'); });
    celda.addEventListener('dragover', (e) => { if (origen === null) return; e.preventDefault(); celda.classList.add('destino'); });
    celda.addEventListener('dragleave', () => celda.classList.remove('destino'));
    celda.addEventListener('drop', (e) => {
      if (origen === null) return;
      e.preventDefault(); e.stopPropagation();
      const destino = Number(celda.dataset.indice);
      if (destino !== origen) { const [m] = imagenes.splice(origen, 1); imagenes.splice(destino, 0, m); }
      origen = null;
      dibujar();
    });
  }

  // ---------- Collage descargable ----------
  function columnasPara(n) { return n === 1 ? 1 : (n === 2 || n === 4) ? 2 : 3; }

  function descargarCollage() {
    if (!imagenes.length) return;
    const n = imagenes.length, cols = columnasPara(n), filas = Math.ceil(n / cols);
    const celda = 600, gap = 16, borde = 24;
    const lienzo = document.createElement('canvas');
    lienzo.width = borde * 2 + cols * celda + (cols - 1) * gap;
    lienzo.height = borde * 2 + filas * celda + (filas - 1) * gap;
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    imagenes.forEach((im, i) => {
      const x = borde + (i % cols) * (celda + gap);
      const y = borde + Math.floor(i / cols) * (celda + gap);
      const esc = Math.min(celda / im.img.naturalWidth, celda / im.img.naturalHeight);
      const w = im.img.naturalWidth * esc, h = im.img.naturalHeight * esc;
      ctx.drawImage(im.img, x + (celda - w) / 2, y + (celda - h) / 2, w, h);
      ctx.fillStyle = '#e84e1b';
      ctx.beginPath(); ctx.arc(x + 26, y + 26, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px Karla, Segoe UI, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x + 26, y + 27);
    });
    const a = document.createElement('a');
    a.href = lienzo.toDataURL('image/jpeg', 0.92);
    a.download = `collage-${new Date().toISOString().slice(0, 10)}.jpg`;
    a.click();
  }

  // ---------- Envío a la IA ----------
  function actualizarBoton() {
    el.analizar.disabled = enviando || !imagenes.length || !el.prompt.value.trim();
  }

  async function analizar() {
    if (el.analizar.disabled) return;
    enviando = true; actualizarBoton();
    el.resultado.hidden = false;
    el.cargando.hidden = false; el.error.hidden = true; el.copiar.hidden = true;
    el.respuesta.innerHTML = ''; el.meta.textContent = '';
    el.resultado.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const r = await fetch('/api/analizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: el.prompt.value,
          modelo: el.modelo.value,
          imagenes: imagenes.map(({ nombre, mimeType, data }) => ({ nombre, mimeType, data })),
        }),
      });
      let d = {};
      try { d = await r.json(); } catch { /* sin JSON */ }
      if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
      ultimaRespuesta = d.texto;
      el.respuesta.innerHTML = markdownSeguro(d.texto);
      const partes = [`${imagenes.length} ${imagenes.length === 1 ? 'imagen' : 'imágenes'}`, d.modelo, `${d.segundos} s`];
      if (d.tokens) partes.push(`${d.tokens.toLocaleString('es-AR')} tokens`);
      el.meta.textContent = partes.join(' · ') + (d.cortado ? ' · La respuesta quedó cortada por largo.' : '');
      el.copiar.hidden = false;
    } catch (e) {
      el.error.textContent = e.message === 'Failed to fetch' ? 'No se pudo conectar con el programa. ¿Sigue abierta la ventana del servidor?' : e.message;
      el.error.hidden = false;
    } finally {
      enviando = false; el.cargando.hidden = true; actualizarBoton();
    }
  }

  // ---------- Markdown mínimo y seguro (todo se escapa antes de dar formato) ----------
  function escapar(t) { return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function enLinea(t) {
    return escapar(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  }
  function markdownSeguro(texto) {
    const salida = [];
    let lista = null; // 'ul' | 'ol'
    let parrafo = [];
    const cerrarParrafo = () => { if (parrafo.length) { salida.push(`<p>${parrafo.map(enLinea).join('<br>')}</p>`); parrafo = []; } };
    const cerrarLista = () => { if (lista) { salida.push(`</${lista}>`); lista = null; } };
    for (const linea of texto.split(/\r?\n/)) {
      const t = linea.trim();
      let m;
      if (!t) { cerrarParrafo(); cerrarLista(); continue; }
      if ((m = t.match(/^(#{1,6})\s+(.*)$/))) { cerrarParrafo(); cerrarLista(); salida.push(`<${m[1].length <= 2 ? 'h3' : 'h4'}>${enLinea(m[2])}</${m[1].length <= 2 ? 'h3' : 'h4'}>`); continue; }
      if ((m = t.match(/^[-*•]\s+(.*)$/))) { cerrarParrafo(); if (lista !== 'ul') { cerrarLista(); salida.push('<ul>'); lista = 'ul'; } salida.push(`<li>${enLinea(m[1])}</li>`); continue; }
      if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { cerrarParrafo(); if (lista !== 'ol') { cerrarLista(); salida.push('<ol>'); lista = 'ol'; } salida.push(`<li>${enLinea(m[1])}</li>`); continue; }
      cerrarLista();
      parrafo.push(t);
    }
    cerrarParrafo(); cerrarLista();
    return salida.join('');
  }

  // ---------- Eventos ----------
  el.archivo.addEventListener('change', () => { agregarArchivos(el.archivo.files); el.archivo.value = ''; });
  el.zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.archivo.click(); } });
  // Soltar archivos en cualquier parte de la página (no cuenta el reordenamiento interno)
  const esArchivo = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragover', (e) => { if (esArchivo(e)) { e.preventDefault(); el.zona.classList.add('encima'); } });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) el.zona.classList.remove('encima'); });
  document.addEventListener('drop', (e) => {
    el.zona.classList.remove('encima');
    if (!esArchivo(e)) return;
    e.preventDefault();
    agregarArchivos(e.dataTransfer.files);
  });
  document.addEventListener('paste', (e) => {
    const archivos = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (archivos.length) { e.preventDefault(); agregarArchivos(archivos); }
  });
  el.vaciar.addEventListener('click', () => { imagenes.length = 0; dibujar(); });
  el.descargar.addEventListener('click', descargarCollage);
  el.prompt.addEventListener('input', actualizarBoton);
  el.prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); analizar(); } });
  el.analizar.addEventListener('click', analizar);
  el.ejemplos.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    el.prompt.value = chip.dataset.texto;
    el.prompt.focus();
    actualizarBoton();
  });
  el.copiar.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ultimaRespuesta); avisar('Conclusión copiada.'); }
    catch { avisar('No se pudo copiar.'); }
  });

  cargarConfig();
  dibujar();
})();
