/* global document, localStorage, matchMedia, window, Element */
// Editing this file changes its CSP hash: run `just golden` and review the one changed line of test/golden/headers.txt.
// The theme script: one classic script that Astro puts in every page's <head> and hashes into the CSP, so it runs
// before first paint and the page never flashes the wrong theme. The class `dark` on <html> switches the token set
// in src/styles/global.css. A choice made with a toggle button (`data-theme-toggle`) is kept in localStorage and
// wins; with none, the system setting decides and is followed live. Storage may be blocked, so every access is
// guarded and the page still renders in the system theme.
(function () {
  var KEY = 'tidwick-theme';
  var root = document.documentElement;
  var system = matchMedia('(prefers-color-scheme: dark)');
  var remembered = null;

  function chosen() {
    try {
      var value = localStorage.getItem(KEY);
      if (value === 'dark' || value === 'light') return value;
    } catch {
      return remembered;
    }
    return remembered;
  }

  function apply() {
    var dark = (chosen() || (system.matches ? 'dark' : 'light')) === 'dark';
    root.classList.toggle('dark', dark);
    var toggles = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].hidden = false;
      toggles[i].setAttribute('aria-pressed', String(dark));
    }
  }

  apply();
  document.addEventListener('DOMContentLoaded', apply);
  system.addEventListener('change', apply);
  window.addEventListener('storage', apply);
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-theme-toggle]')) return;
    remembered = root.classList.contains('dark') ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, remembered);
    } catch {
      // The choice holds for this page only.
    }
    apply();
  });
})();
