// Tiny DOM construction helpers used throughout the UI layer: `el` (element with
// optional class/text), `btn` (button with click handler), and `renderCubeNet`
// (the 54-sticker cube-net view). Pure DOM — no app state.

export function el(tag: string, className = '', text = ''): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

export function btn(label: string, onClick: () => void, className = '', disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (className) b.className = className;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

export function renderCubeNet(f: string, highlight: Set<number> | null = null, blank: Set<number> | null = null): HTMLElement {
  const net = el('div', 'cube-net');
  for (let i = 0; i < 54; i++) {
    let row: number, col: number;
    if (i < 9) { row = Math.floor(i / 3); col = 3 + (i % 3); }
    else if (i < 45) { const p = i - 9; row = 3 + Math.floor(p / 12); col = p % 12; }
    else { const j = i - 45; row = 6 + Math.floor(j / 3); col = 3 + (j % 3); }
    const isBlank = blank?.has(i);
    const dim = !isBlank && highlight && !highlight.has(i) ? ' dim' : '';
    const sticker = el('div', isBlank ? 'sticker blank' : `sticker ${f[i]}${dim}`);
    sticker.style.gridRow = `${row + 1}`;
    sticker.style.gridColumn = `${col + 1}`;
    net.appendChild(sticker);
  }
  return net;
}
