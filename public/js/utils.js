// Shared utilities used by both app.js and editor.js.

// Filter a list in real-time: hides items in `container` matching `selector`
// whose text doesn't include the current value of `inputEl`.
export function filterList(inputEl, container, selector) {
  const q = inputEl.value.trim().toLowerCase();
  container.querySelectorAll(selector).forEach(el => {
    el.hidden = q !== '' && !el.textContent.toLowerCase().includes(q);
  });
}
