// Sun/moon theme switch (card #585). The inline snippet in each page's <head>
// applies a stored choice before first paint; this file shows the button, flips
// the theme on a tap, and keeps the page, the browser's address-bar colour and
// other open tabs in step. With no stored choice the page follows the device.
(function () {
  var KEY = 'synapse-theme';
  var root = document.documentElement;
  var device = window.matchMedia('(prefers-color-scheme: dark)');
  var sessionChoice = null; // used when the browser blocks storage

  function storedChoice() {
    try {
      var t = localStorage.getItem(KEY);
      return t === 'light' || t === 'dark' ? t : null;
    } catch (e) {
      return null;
    }
  }

  function choice() {
    return storedChoice() || sessionChoice;
  }

  function effective() {
    return choice() || (device.matches ? 'dark' : 'light');
  }

  var metas = Array.prototype.slice.call(document.querySelectorAll('meta[name="theme-color"]'));
  metas.forEach(function (m) { m.setAttribute('data-device', m.getAttribute('content')); });

  function apply() {
    var picked = choice();
    if (picked) {
      root.setAttribute('data-theme', picked);
      root.style.colorScheme = picked;
    } else {
      root.removeAttribute('data-theme');
      root.style.colorScheme = '';
    }
    // A forced theme overrides both media-scoped address-bar colours.
    var background = getComputedStyle(root).getPropertyValue('--background').trim();
    metas.forEach(function (m) {
      m.setAttribute('content', picked && background ? background : m.getAttribute('data-device'));
    });
    var dark = effective() === 'dark';
    document.querySelectorAll('.theme-toggle').forEach(function (b) {
      b.setAttribute('aria-pressed', dark ? 'true' : 'false');
      b.setAttribute('title', dark ? 'Switch to light theme' : 'Switch to dark theme');
    });
  }

  function toggle() {
    var next = effective() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
      sessionChoice = null;
    } catch (e) {
      sessionChoice = next;
    }
    apply();
  }

  document.querySelectorAll('.theme-toggle').forEach(function (b) {
    b.addEventListener('click', toggle);
  });
  document.querySelectorAll('.nav-theme').forEach(function (li) { li.hidden = false; });

  if (device.addEventListener) device.addEventListener('change', apply);
  else if (device.addListener) device.addListener(apply);
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) apply(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) apply(); });

  // Printed pages always use the light theme.
  window.addEventListener('beforeprint', function () {
    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';
  });
  window.addEventListener('afterprint', apply);

  apply();
})();
