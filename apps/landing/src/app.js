// @ts-check
import { renderPage } from './render.js';

const MANIFEST_URL = './releases.json';

const main = async () => {
  const latest = document.getElementById('latest');
  const list = document.getElementById('releases');
  const empty = document.getElementById('empty');
  const note = document.getElementById('manifest-note');
  if (!latest || !list || !empty || !note) return;
  try {
    const response = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`manifest ${response.status}`);
    const page = renderPage(await response.json());
    latest.innerHTML = page.latest;
    list.innerHTML = page.list;
    empty.hidden = !page.empty;
    note.textContent = page.note;
  } catch {
    latest.innerHTML = '<p class="muted">No se pudo cargar la lista de versiones. Probá de nuevo en un rato.</p>';
  }
};

void main();
