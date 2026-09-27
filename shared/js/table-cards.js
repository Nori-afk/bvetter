/**
 * BVetter – Phone card layout for data tables  (shared/js/table-cards.js)
 * ─────────────────────────────────────────────────────────────
 * Opt a table in with `data-cards`. Below 768px shared/css/table-cards.css
 * shows each row as a card, and the header row is hidden, so every cell
 * needs its column's name as a label. This script copies it onto the cell
 * as `data-label` and tags the cells that play a special part.
 *
 * Column roles, set on the header cell:
 *   data-card="title"    the card's heading. Defaults to the first column
 *                        that is not a checkbox.
 *   data-card="select"   a row checkbox, pinned to the card's corner. Its
 *                        header checkbox stays visible as "Select all".
 *   data-card="actions"  buttons, full width at the bottom. Defaults to a
 *                        column headed "Action" or "Actions".
 *
 * Every page renders its own rows, usually by replacing the tbody's
 * innerHTML, so the labelling runs off a MutationObserver instead of a
 * call each renderer would have to remember to make.
 * ─────────────────────────────────────────────────────────────
 */

(function () {
    'use strict';

    function columnRoles(table) {
        const heads = Array.from(table.querySelectorAll('thead > tr:first-child > th'));
        const roles = heads.map(th => {
            if (th.dataset.card) return th.dataset.card;
            return /^actions?$/i.test(th.textContent.trim()) ? 'actions' : '';
        });
        if (!roles.includes('title')) {
            const first = roles.findIndex(role => role !== 'select');
            if (first !== -1 && roles[first] === '') roles[first] = 'title';
        }
        return heads.map((th, i) => ({ label: th.textContent.trim(), role: roles[i] }));
    }

    function labelTable(table) {
        const columns = columnRoles(table);
        table.querySelectorAll(':scope > tbody > tr').forEach(tr => {
            let index = 0;
            for (const cell of tr.children) {
                const span = cell.colSpan || 1;
                if (span > 1) {
                    cell.classList.add('bv-cell-full');
                } else if (columns[index]) {
                    const column = columns[index];
                    if (cell.dataset.label !== column.label) cell.dataset.label = column.label;
                    if (column.role) cell.classList.add('bv-cell-' + column.role);
                    if (column.role === 'actions') {
                        cell.classList.toggle('bv-cell-empty', !cell.querySelector('button, a, input, select'));
                    }
                }
                index += span;
            }
        });
    }

    let queued = false;
    function labelAll() {
        queued = false;
        document.querySelectorAll('table[data-cards]').forEach(labelTable);
    }

    function queue() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(labelAll);
    }

    function init() {
        labelAll();
        new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
