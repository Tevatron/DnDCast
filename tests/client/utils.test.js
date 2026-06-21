// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { filterList } from '../../public/js/utils.js';

// Build a minimal DOM container with list items for each test.
function makeList(titles) {
  const container = document.createElement('ul');
  titles.forEach(t => {
    const li = document.createElement('li');
    li.textContent = t;
    container.appendChild(li);
  });
  return container;
}

function makeInput(value = '') {
  const input = document.createElement('input');
  input.value = value;
  return input;
}

describe('filterList', () => {
  it('shows all items when query is empty', () => {
    const container = makeList(['Tavern', 'Forest', 'Cave']);
    const input = makeInput('');
    filterList(input, container, 'li');
    const hidden = Array.from(container.querySelectorAll('li')).filter(li => li.hidden);
    expect(hidden).toHaveLength(0);
  });

  it('hides items that do not match the query', () => {
    const container = makeList(['Tavern', 'Forest', 'Cave']);
    const input = makeInput('tav');
    filterList(input, container, 'li');
    const visible = Array.from(container.querySelectorAll('li')).filter(li => !li.hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toBe('Tavern');
  });

  it('is case-insensitive', () => {
    const container = makeList(['Moonlit Forest Road', 'Tavern']);
    const input = makeInput('FOREST');
    filterList(input, container, 'li');
    const visible = Array.from(container.querySelectorAll('li')).filter(li => !li.hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toBe('Moonlit Forest Road');
  });

  it('shows all items when query is whitespace only', () => {
    const container = makeList(['A', 'B', 'C']);
    const input = makeInput('   ');
    filterList(input, container, 'li');
    const hidden = Array.from(container.querySelectorAll('li')).filter(li => li.hidden);
    expect(hidden).toHaveLength(0);
  });

  it('hides all items when nothing matches', () => {
    const container = makeList(['Tavern', 'Forest']);
    const input = makeInput('zzz-no-match');
    filterList(input, container, 'li');
    const hidden = Array.from(container.querySelectorAll('li')).filter(li => li.hidden);
    expect(hidden).toHaveLength(2);
  });

  it('restores visibility when query is cleared', () => {
    const container = makeList(['Tavern', 'Forest']);
    const input = makeInput('tav');
    filterList(input, container, 'li');

    input.value = '';
    filterList(input, container, 'li');

    const hidden = Array.from(container.querySelectorAll('li')).filter(li => li.hidden);
    expect(hidden).toHaveLength(0);
  });
});
