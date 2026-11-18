// D&D fork — undo and redo (Ctrl + Z; Ctrl + Y or Ctrl + Shift + Z; ⌘ on a Mac), for every edit the page keeps: the plates
// marked, the world rebuilt or made anew, and the realm — its kingdoms' wishes, names, colours, cities, capitals and
// routes. One history for the page: each entry knows how to go back and forth (`undo()`, `redo()`, either may be async).

const past = [], future = [], MAX = 60;
let isBusy = () => false, toast = null, hideAt = 0;

/** The page's history of edits. */
export const history = {
    /** One edit done: `{ label, undo, redo }`. Clears what could be redone. */
    push(entry) { past.push(entry); if (past.length > MAX) past.shift(); future.length = 0; },
    /** While true (a world building, the kingdoms being placed), an undo waits. */
    setBusy(f) { isBusy = f; },
    /** True while an undo or redo runs: the edits it makes are not new entries. */
    replaying: false,
    get canUndo() { return past.length > 0; },
};

function say(text) {
    if (!toast) { toast = document.createElement('div'); toast.className = 'dnd-toast'; toast.setAttribute('role', 'status'); document.body.appendChild(toast); }
    toast.textContent = text; toast.hidden = false;
    hideAt = performance.now() + 2200;
    setTimeout(() => { if (performance.now() >= hideAt - 10) toast.hidden = true; }, 2300);
}

async function step(from, to, back) {
    if (!from.length) { say(back ? 'Nothing to undo' : 'Nothing to redo'); return; }
    if (isBusy()) { say('Wait: the world or the kingdoms are still being made'); return; }
    const e = from.pop();
    history.replaying = true;
    try { await (back ? e.undo() : e.redo()); } catch (err) { console.error(err); }
    finally { history.replaying = false; }
    to.push(e);
    say(`${back ? 'Undone' : 'Redone'}: ${e.label}`);
}

addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    // (typing in a box: the box's own undo)
    const t = e.target;
    if (t && ((t.tagName === 'INPUT' && !['checkbox', 'range', 'color', 'radio', 'button'].includes(t.type)) || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); step(past, future, true); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); step(future, past, false); }
});
