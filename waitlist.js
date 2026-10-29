(function () {
  var ENDPOINT = 'https://odpmtcscrhjisxpajpto.supabase.co/functions/v1/join-waitlist';
  var SHARE_URL = 'https://synapsematches.com/?ref=share';
  var SHARE_TEXT = 'I just joined the waitlist for Synapse, a verified dating app for healthcare workers. The first 500 verified members get 3 months of Synapse+ free.';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PLACE_ERROR = 'Please choose your city or town from the list.';
  var MAX_MATCHES = 8;
  var placesPromise = null;

  // The US city/town list (Census Gazetteer, scripts/build-us-places.mjs), fetched once on first focus.
  function loadPlaces() {
    if (!placesPromise) {
      placesPromise = fetch('/assets/us-places.json')
        .then(function (res) { if (!res.ok) throw new Error('Failed to fetch'); return res.json(); })
        .then(function (rows) {
          return rows.map(function (row) {
            var p = row.split('|');
            return { city: p[0], state: p[1], geoid: p[2], lat: +p[3], lon: +p[4], key: p[0].toLowerCase() };
          });
        })
        .catch(function (err) { placesPromise = null; throw err; });
    }
    return placesPromise;
  }

  // "spring" or "springfield, i": names that start with it first, then names with a word that does.
  function searchPlaces(places, query) {
    var parts = query.toLowerCase().split(',');
    var name = parts[0].trim();
    var state = (parts[1] || '').trim().toUpperCase();
    if (name.length < 2) return [];
    var starts = [], words = [];
    for (var i = 0; i < places.length && starts.length < MAX_MATCHES; i++) {
      var p = places[i];
      if (state && p.state.indexOf(state) !== 0) continue;
      var at = p.key.indexOf(name);
      if (at === 0) starts.push(p);
      else if (at > 0 && words.length < MAX_MATCHES && /[\s\-]/.test(p.key.charAt(at - 1))) words.push(p);
    }
    return starts.concat(words).slice(0, MAX_MATCHES);
  }

  function placeLabel(p) { return p.city + ', ' + p.state; }

  // An accessible combobox on the city field; form.placeChoice is the picked place or null.
  function setupPlaceField(form) {
    var input = form.querySelector('input[name="place"]');
    var list = form.querySelector('.waitlist-place-list');
    var status = form.parentNode.querySelector('.waitlist-status');
    if (!input || !list) return;
    var matches = [];
    var active = -1;
    form.placeChoice = null;
    form.placeInput = input;

    function resetActive() {
      active = -1;
      input.removeAttribute('aria-activedescendant');
    }

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      resetActive();
    }

    function setActive(i) {
      var items = list.querySelectorAll('[role="option"]:not([aria-disabled])');
      if (!items.length) return;
      active = (i + items.length) % items.length;
      for (var k = 0; k < items.length; k++) items[k].setAttribute('aria-selected', k === active ? 'true' : 'false');
      input.setAttribute('aria-activedescendant', items[active].id);
      items[active].scrollIntoView({ block: 'nearest' });
    }

    function choose(i) {
      var p = matches[i];
      if (!p) return;
      form.placeChoice = p;
      input.value = placeLabel(p);
      close();
    }

    function render() {
      list.innerHTML = '';
      resetActive();
      if (!matches.length) {
        var none = document.createElement('li');
        none.setAttribute('role', 'option');
        none.setAttribute('aria-disabled', 'true');
        none.className = 'is-empty';
        none.textContent = 'No US city or town matches that.';
        list.appendChild(none);
      }
      matches.forEach(function (p, i) {
        var li = document.createElement('li');
        li.id = list.id + '-' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.textContent = placeLabel(p);
        // mousedown, not click, so the input keeps focus.
        li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(i); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function update() {
      var query = input.value;
      if (query.trim().length < 2) { matches = []; close(); return; }
      loadPlaces().then(function (places) {
        if (input.value !== query) return; // a newer keystroke is already handled
        matches = searchPlaces(places, query);
        status.textContent = '';
        status.className = 'waitlist-status';
        render();
      }, function () {
        // The list didn't load; the next keystroke tries again.
        close();
        status.textContent = 'Network error — please try again.';
        status.className = 'waitlist-status is-error';
      });
    }

    input.addEventListener('focus', function () { loadPlaces().catch(function () {}); });
    input.addEventListener('input', function () { form.placeChoice = null; update(); });
    input.addEventListener('blur', close);
    input.addEventListener('keydown', function (e) {
      if (list.hidden) {
        if (e.key === 'ArrowDown' && !form.placeChoice) { update(); e.preventDefault(); }
        return;
      }
      if (e.key === 'ArrowDown') { setActive(active + 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { setActive(active - 1); e.preventDefault(); }
      else if (e.key === 'Enter') {
        // Enter picks the highlighted (or else the first) match instead of submitting.
        var i = active >= 0 ? active : (matches.length ? 0 : -1);
        if (i >= 0) { choose(i); e.preventDefault(); }
      }
      else if (e.key === 'Escape') { close(); e.preventDefault(); }
    });
  }

  function showShare(block) {
    block.innerHTML =
      '<div class="waitlist-done">' +
        '<p class="waitlist-success">You’re on the list — check your inbox ✓</p>' +
        '<p>Know someone in healthcare who’s done with the usual apps? Send them Synapse.</p>' +
        '<button class="btn btn-primary share-btn" type="button">Share with a coworker</button>' +
        '<p class="waitlist-status" role="status" aria-live="polite"></p>' +
      '</div>';
    var btn = block.querySelector('.share-btn');
    var status = block.querySelector('.waitlist-status');
    btn.addEventListener('click', function () {
      if (navigator.share) {
        navigator.share({ title: 'Synapse', text: SHARE_TEXT, url: SHARE_URL }).catch(function () {});
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(SHARE_TEXT + ' ' + SHARE_URL).then(function () {
          btn.textContent = 'Link copied ✓';
          status.textContent = 'Paste it into a text or group chat.';
        }, function () {
          status.textContent = SHARE_URL;
        });
      } else {
        status.textContent = SHARE_URL;
      }
    });
  }

  document.querySelectorAll('.waitlist-block').forEach(function (block) {
    var form = block.querySelector('.waitlist-form');
    var status = block.querySelector('.waitlist-status');
    if (!form || !status) return;
    setupPlaceField(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var emailInput = form.querySelector('input[name="email"]');
      var honeypot = form.querySelector('input[name="company"]');
      var button = form.querySelector('button[type="submit"]');
      var label = button.textContent;
      var email = emailInput.value.trim();

      if (!EMAIL_RE.test(email)) {
        status.textContent = 'Please enter a valid email address.';
        status.className = 'waitlist-status is-error';
        emailInput.focus();
        return;
      }

      var place = form.placeChoice;
      if (!place) {
        status.textContent = PLACE_ERROR;
        status.className = 'waitlist-status is-error';
        if (form.placeInput) form.placeInput.focus();
        return;
      }

      button.disabled = true;
      button.textContent = 'Joining…';
      status.textContent = '';
      status.className = 'waitlist-status';

      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          company: honeypot ? honeypot.value : '',
          place: { geoid: place.geoid, city: place.city, state: place.state, lat: place.lat, lon: place.lon }
        })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok) {
            showShare(block);
          } else {
            throw new Error((result.data && result.data.error) || 'Something went wrong.');
          }
        })
        .catch(function (err) {
          status.textContent = err.message === 'Failed to fetch'
            ? 'Network error — please try again.'
            : err.message;
          status.className = 'waitlist-status is-error';
          button.disabled = false;
          button.textContent = label;
        });
    });
  });
})();
