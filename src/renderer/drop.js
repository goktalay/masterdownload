'use strict';
const ball = document.getElementById('ball');
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); ball.classList.add('over'); }));
document.addEventListener('dragleave', () => ball.classList.remove('over'));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  ball.classList.remove('over');
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (text) window.api.dropText(text);
});
ball.addEventListener('dblclick', () => window.api.showMain());
ball.addEventListener('contextmenu', (e) => { e.preventDefault(); window.api.dropTarget(false); });
