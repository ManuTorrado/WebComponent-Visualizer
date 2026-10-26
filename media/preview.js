/* The webview only displays frames and forwards input. Workspace code runs in Chromium. */
(() => {
  const vscode = acquireVsCodeApi();
  const byId = id => document.getElementById(id);
  const screen = byId('screen');
  let width = 900, height = 600;
  let movePending;
  const send = message => vscode.postMessage(message);
  const status = text => { byId('status').textContent = text; };
  const error = text => { byId('error').hidden = false; byId('error').textContent = text; status('Error'); };

  window.addEventListener('message', ({ data }) => {
    switch (data.type) {
      case 'init': {
        for (const [key, value] of Object.entries(data.options)) {
          const input = byId(key);
          if (input) input.value = typeof value === 'object' ? JSON.stringify(value, null, 2) : value;
        }
        width = data.options.width; height = data.options.height;
        byId('tag').title = data.file;
        break;
      }
      case 'tags':
        byId('tags').replaceChildren(...data.tags.map(tag => Object.assign(document.createElement('option'), { value: tag })));
        break;
      case 'status': status(data.text); break;
      case 'mounted':
        width = data.width; height = data.height;
        byId('error').hidden = true;
        byId('dimensions').textContent = `${width} × ${height}`;
        screen.style.width = `${width}px`;
        status('Conectado');
        break;
      case 'frame':
        screen.src = `data:image/jpeg;base64,${data.data}`;
        screen.hidden = false;
        byId('placeholder').hidden = true;
        break;
      case 'error': error(data.text); break;
    }
  });

  byId('controls').addEventListener('submit', event => {
    event.preventDefault();
    try {
      send({ type: 'apply', options: {
        tag: byId('tag').value.trim(), attributes: JSON.parse(byId('attributes').value),
        properties: JSON.parse(byId('properties').value), html: byId('html').value,
        width: Number(byId('width').value), height: Number(byId('height').value), background: byId('background').value
      } });
      status('Aplicando…');
    } catch (err) { error(`JSON no válido: ${err.message}`); }
  });
  byId('reload').addEventListener('click', () => send({ type: 'reload' }));
  const point = event => {
    const rect = screen.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width - 1, (event.clientX - rect.left) * width / rect.width)),
      y: Math.max(0, Math.min(height - 1, (event.clientY - rect.top) * height / rect.height))
    };
  };
  screen.addEventListener('pointerdown', event => {
    event.preventDefault(); screen.focus(); screen.setPointerCapture(event.pointerId);
    send({ type: 'input', kind: 'down', ...point(event), button: event.button });
  });
  screen.addEventListener('pointerup', event => {
    send({ type: 'input', kind: 'up', ...point(event), button: event.button });
    if (screen.hasPointerCapture(event.pointerId)) screen.releasePointerCapture(event.pointerId);
  });
  screen.addEventListener('pointercancel', event => send({ type: 'input', kind: 'up', ...point(event), button: 0 }));
  screen.addEventListener('pointermove', event => {
    movePending = point(event);
  });
  setInterval(() => {
    if (movePending) { send({ type: 'input', kind: 'move', ...movePending }); movePending = undefined; }
  }, 50);
  screen.addEventListener('contextmenu', event => event.preventDefault());
  screen.addEventListener('wheel', event => {
    event.preventDefault();
    send({ type: 'input', kind: 'move', ...point(event) });
    const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    send({ type: 'input', kind: 'wheel', dx: event.deltaX * multiplier, dy: event.deltaY * multiplier });
  }, { passive: false });
  screen.addEventListener('keydown', event => {
    // Escape releases keyboard focus back to VS Code.
    if (event.key === 'Escape') { screen.blur(); return; }
    if (['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Process'].includes(event.key)) return;
    event.preventDefault();
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      send({ type: 'input', kind: 'text', text: event.key });
    } else {
      const modifiers = [event.ctrlKey && 'Control', event.metaKey && 'Meta', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean);
      send({ type: 'input', kind: 'key', key: [...modifiers, event.key === ' ' ? 'Space' : event.key].join('+') });
    }
  });
  send({ type: 'ready' });
})();
