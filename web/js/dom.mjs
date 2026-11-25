// Tiny DOM helpers. The page forbids inline scripts and styles, so every node
// is built here rather than from HTML strings.

const SVG = 'http://www.w3.org/2000/svg';

export const $ = (id) => document.getElementById(id);

/** el('span', { class: 'x', text: 'hello', onclick: fn }, child, …) */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'text') node.textContent = value;
    else if (name === 'class') node.className = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

/** One of the symbols declared at the top of the page. */
export function icon(id, className) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}
