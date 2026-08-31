(function () {
  'use strict';

  /* ---------------------------------------------------------------------
   * Storage
   * ------------------------------------------------------------------- */
  const DB_KEY = 'calorieTrackerData';

  function defaultDb() {
    return {
      version: 1,
      settings: {
        calorieGoal: 2200, proteinGoal: 150, carbsGoal: 220, fatGoal: 70,
        ai: {
          provider: 'none', // 'none' | 'gemini' | 'claude'
          gemini: { apiKey: '', model: 'gemini-2.5-flash' },
          claude: { apiKey: '', model: 'claude-haiku-4-5-20251001' },
        },
      },
      foods: [],
      supplements: [],
      logs: {},   // { 'YYYY-MM-DD': { meals: [...], supplements: [...] } }
      weight: []  // [{ date, kg }]
    };
  }

  // Merge a (possibly partial / older-shape) parsed object onto a fresh default DB,
  // so new fields (like AI settings) always exist even for data saved before they did.
  function normalizeDb(parsed) {
    parsed = parsed && typeof parsed === 'object' ? parsed : {};
    const fresh = defaultDb();
    const merged = Object.assign({}, fresh, parsed);
    merged.settings = Object.assign({}, fresh.settings, parsed.settings || {});
    const pAi = (parsed.settings && parsed.settings.ai) || {};
    merged.settings.ai = Object.assign({}, fresh.settings.ai, pAi);
    merged.settings.ai.gemini = Object.assign({}, fresh.settings.ai.gemini, pAi.gemini || {});
    merged.settings.ai.claude = Object.assign({}, fresh.settings.ai.claude, pAi.claude || {});
    merged.foods = Array.isArray(parsed.foods) ? parsed.foods : fresh.foods;
    merged.supplements = Array.isArray(parsed.supplements) ? parsed.supplements : fresh.supplements;
    merged.logs = parsed.logs && typeof parsed.logs === 'object' ? parsed.logs : fresh.logs;
    merged.weight = Array.isArray(parsed.weight) ? parsed.weight : fresh.weight;
    return merged;
  }

  function loadDb() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return defaultDb();
      return normalizeDb(JSON.parse(raw));
    } catch (e) {
      console.error('Failed to load data, starting fresh', e);
      return defaultDb();
    }
  }

  function saveDb() {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  let db = loadDb();

  /* ---------------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------------- */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function round(n, d) {
    d = d || 0;
    const f = Math.pow(10, d);
    return Math.round((n + Number.EPSILON) * f) / f;
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function toDateStr(dateObj) {
    return dateObj.getFullYear() + '-' + pad2(dateObj.getMonth() + 1) + '-' + pad2(dateObj.getDate());
  }

  function todayStr() { return toDateStr(new Date()); }

  function parseDateStr(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(dateStr, delta) {
    const d = parseDateStr(dateStr);
    d.setDate(d.getDate() + delta);
    return toDateStr(d);
  }

  function formatDateLabel(dateStr) {
    const today = todayStr();
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);
    if (dateStr === today) return 'Today';
    if (dateStr === yesterday) return 'Yesterday';
    if (dateStr === tomorrow) return 'Tomorrow';
    const d = parseDateStr(dateStr);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function getLog(dateStr) {
    if (!db.logs[dateStr]) db.logs[dateStr] = { meals: [], supplements: [] };
    if (!db.logs[dateStr].meals) db.logs[dateStr].meals = [];
    if (!db.logs[dateStr].supplements) db.logs[dateStr].supplements = [];
    return db.logs[dateStr];
  }

  function peekLog(dateStr) {
    return db.logs[dateStr] || { meals: [], supplements: [] };
  }

  function dayTotals(dateStr) {
    const log = peekLog(dateStr);
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    (log.meals || []).forEach((m) => {
      totals.calories += m.calories || 0;
      totals.protein += m.protein || 0;
      totals.carbs += m.carbs || 0;
      totals.fat += m.fat || 0;
    });
    (log.supplements || []).forEach((s) => {
      totals.calories += s.calories || 0;
    });
    return totals;
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ---------------------------------------------------------------------
   * State
   * ------------------------------------------------------------------- */
  const state = {
    currentDate: todayStr(),
    activeTab: 'today',
  };

  /* ---------------------------------------------------------------------
   * Bottom sheet
   * ------------------------------------------------------------------- */
  const sheetEl = document.getElementById('sheet');
  const sheetBackdrop = document.getElementById('sheet-backdrop');
  const sheetContent = document.getElementById('sheet-content');

  function openSheet(html) {
    stopActiveCamera(); // in case a barcode scan was left running under a previous sheet
    sheetContent.innerHTML = html;
    sheetEl.classList.remove('hidden');
    sheetBackdrop.classList.remove('hidden');
  }

  function closeSheet() {
    stopActiveCamera();
    sheetEl.classList.add('hidden');
    sheetBackdrop.classList.add('hidden');
    sheetContent.innerHTML = '';
  }

  sheetBackdrop.addEventListener('click', closeSheet);

  /* ---------------------------------------------------------------------
   * Tabs
   * ------------------------------------------------------------------- */
  const tabTitles = { today: 'Today', foods: 'Foods', supps: 'Supplements', history: 'History', settings: 'Settings' };

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.tab !== tab);
    });
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.getElementById('topbar-title').textContent = tabTitles[tab];
    document.getElementById('date-nav').style.visibility = tab === 'today' ? 'visible' : 'hidden';
    renderActiveTab();
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  function renderActiveTab() {
    if (state.activeTab === 'today') renderToday();
    else if (state.activeTab === 'foods') renderFoods();
    else if (state.activeTab === 'supps') renderSupps();
    else if (state.activeTab === 'history') renderHistory();
    else if (state.activeTab === 'settings') renderSettings();
  }

  /* ---------------------------------------------------------------------
   * Date navigation (Today tab)
   * ------------------------------------------------------------------- */
  document.getElementById('date-prev').addEventListener('click', () => {
    state.currentDate = addDays(state.currentDate, -1);
    renderToday();
  });
  document.getElementById('date-next').addEventListener('click', () => {
    state.currentDate = addDays(state.currentDate, 1);
    renderToday();
  });
  document.getElementById('date-label').addEventListener('click', () => {
    openSheet(`
      <h3>Jump to date</h3>
      <label class="field">Date<input type="date" id="jump-date" value="${state.currentDate}"></label>
      <button class="btn-primary full-width" id="jump-go">Go</button>
    `);
    document.getElementById('jump-go').addEventListener('click', () => {
      const v = document.getElementById('jump-date').value;
      if (v) { state.currentDate = v; renderToday(); }
      closeSheet();
    });
  });

  /* ---------------------------------------------------------------------
   * TODAY TAB
   * ------------------------------------------------------------------- */
  function renderToday() {
    document.getElementById('date-label').textContent = formatDateLabel(state.currentDate);

    const totals = dayTotals(state.currentDate);
    const s = db.settings;
    const remaining = s.calorieGoal - totals.calories;

    document.getElementById('calories-consumed').textContent = round(totals.calories);
    document.getElementById('calories-goal').textContent = round(s.calorieGoal);
    document.getElementById('calories-remaining').textContent = round(Math.max(remaining, 0));

    const overWrap = document.getElementById('calories-over-wrap');
    if (remaining < 0) {
      overWrap.classList.remove('hidden');
      document.getElementById('calories-over').textContent = round(-remaining);
    } else {
      overWrap.classList.add('hidden');
    }

    const pct = s.calorieGoal > 0 ? Math.min(totals.calories / s.calorieGoal, 1) : 0;
    const circumference = 326.7;
    const ring = document.getElementById('calorie-ring');
    ring.style.strokeDashoffset = circumference * (1 - pct);
    ring.style.stroke = remaining < 0 ? getCss('--over') : getCss('--accent');

    setMacroBar('protein', totals.protein, s.proteinGoal);
    setMacroBar('carbs', totals.carbs, s.carbsGoal);
    setMacroBar('fat', totals.fat, s.fatGoal);

    renderMealList();
    renderSuppLogList();
  }

  function getCss(varName) {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  function setMacroBar(key, consumed, goal) {
    document.getElementById(key + '-consumed').textContent = round(consumed);
    document.getElementById(key + '-goal').textContent = round(goal);
    const pct = goal > 0 ? Math.min((consumed / goal) * 100, 100) : 0;
    document.getElementById(key + '-bar').style.width = pct + '%';
  }

  function renderMealList() {
    const log = peekLog(state.currentDate);
    const list = document.getElementById('meal-list');
    if (!log.meals || log.meals.length === 0) {
      list.innerHTML = '<div class="empty-msg">No meals logged yet.</div>';
      return;
    }
    list.innerHTML = log.meals.map((m) => `
      <div class="entry" data-id="${m.id}">
        <div class="entry-main">
          <div class="entry-title">${escapeHtml(m.name)}</div>
          <div class="entry-sub">${round(m.qty, 2)} × ${escapeHtml(m.unitLabel)} · P${round(m.protein)} C${round(m.carbs)} F${round(m.fat)}</div>
        </div>
        <div class="entry-cals">${round(m.calories)}</div>
        <button class="entry-remove" data-remove-meal="${m.id}" aria-label="Remove">×</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-remove-meal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.removeMeal;
        const l = getLog(state.currentDate);
        l.meals = l.meals.filter((m) => m.id !== id);
        saveDb();
        renderToday();
      });
    });
  }

  function renderSuppLogList() {
    const log = peekLog(state.currentDate);
    const list = document.getElementById('supp-list');
    if (!log.supplements || log.supplements.length === 0) {
      list.innerHTML = '<div class="empty-msg">Nothing logged yet.</div>';
      return;
    }
    list.innerHTML = log.supplements.map((sp) => `
      <div class="entry" data-id="${sp.id}">
        <div class="entry-main">
          <div class="entry-title">${escapeHtml(sp.name)}</div>
          <div class="entry-sub">${round(sp.amount, 2)} ${escapeHtml(sp.unit)}${sp.calories ? ' · ' + round(sp.calories) + ' kcal' : ''}</div>
        </div>
        <button class="entry-remove" data-remove-supp="${sp.id}" aria-label="Remove">×</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-remove-supp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.removeSupp;
        const l = getLog(state.currentDate);
        l.supplements = l.supplements.filter((s) => s.id !== id);
        saveDb();
        renderToday();
      });
    });
  }

  /* ---- Add food to today's log ---- */
  document.getElementById('add-food-btn').addEventListener('click', () => openAddFoodSheet());

  function openAddFoodSheet() {
    openSheet(`
      <h3>Add food</h3>
      <input type="search" id="qa-filter" placeholder="Filter your library…" class="qa-filter-input" style="width:100%;margin-bottom:12px;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:11px 12px;font-size:15px;">
      <div class="quick-add-list" id="qa-food-list"></div>
      <button class="btn-secondary full-width" id="qa-goto-foods" style="margin-top:12px;">Manage / search more foods →</button>
    `);
    const listEl = document.getElementById('qa-food-list');
    function renderList(filter) {
      const f = (filter || '').toLowerCase();
      const items = db.foods.filter((food) => food.name.toLowerCase().includes(f));
      if (items.length === 0) {
        listEl.innerHTML = '<div class="empty-msg">No foods in your library yet. Use "Manage / search more foods" to add some.</div>';
        return;
      }
      listEl.innerHTML = items.map((food) => `
        <div class="quick-add-item">
          <div class="qa-main">
            <div class="qa-title">${escapeHtml(food.name)}</div>
            <div class="qa-sub">${round(food.calories)} kcal / ${escapeHtml(food.servingLabel)}</div>
          </div>
          <input type="number" min="0" step="0.25" value="1" style="width:56px;text-align:center;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px;" data-qty="${food.id}">
          <button data-add-food="${food.id}">Add</button>
        </div>
      `).join('');
      listEl.querySelectorAll('[data-add-food]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.addFood;
          const food = db.foods.find((f) => f.id === id);
          const qtyInput = listEl.querySelector(`[data-qty="${id}"]`);
          const qty = parseFloat(qtyInput.value) || 1;
          const l = getLog(state.currentDate);
          l.meals.push({
            id: uid(), foodId: food.id, name: food.name, qty,
            unitLabel: food.servingLabel,
            calories: round(food.calories * qty, 1),
            protein: round(food.protein * qty, 1),
            carbs: round(food.carbs * qty, 1),
            fat: round(food.fat * qty, 1),
            time: new Date().toISOString(),
          });
          saveDb();
          closeSheet();
          renderToday();
          toast('Added ' + food.name);
        });
      });
    }
    renderList('');
    document.getElementById('qa-filter').addEventListener('input', (e) => renderList(e.target.value));
    document.getElementById('qa-goto-foods').addEventListener('click', () => { closeSheet(); switchTab('foods'); });
  }

  /* ---- Add supplement to today's log ---- */
  document.getElementById('add-supp-btn').addEventListener('click', () => openAddSuppSheet());

  function openAddSuppSheet() {
    if (db.supplements.length === 0) {
      openSheet(`
        <h3>Log a supplement</h3>
        <div class="empty-msg">No supplements in your library yet.</div>
        <button class="btn-secondary full-width" id="qa-goto-supps">Add a supplement →</button>
      `);
      document.getElementById('qa-goto-supps').addEventListener('click', () => { closeSheet(); switchTab('supps'); });
      return;
    }
    openSheet(`
      <h3>Log a supplement</h3>
      <div class="quick-add-list" id="qa-supp-list"></div>
    `);
    const listEl = document.getElementById('qa-supp-list');
    listEl.innerHTML = db.supplements.map((sp) => `
      <div class="quick-add-item">
        <div class="qa-main">
          <div class="qa-title">${escapeHtml(sp.name)}</div>
          <div class="qa-sub">default ${round(sp.defaultAmount, 2)} ${escapeHtml(sp.unit)}</div>
        </div>
        <input type="number" min="0" step="0.25" value="${sp.defaultAmount}" style="width:64px;text-align:center;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px;" data-amt="${sp.id}">
        <button data-add-supp="${sp.id}">Add</button>
      </div>
    `).join('');
    listEl.querySelectorAll('[data-add-supp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.addSupp;
        const sp = db.supplements.find((s) => s.id === id);
        const amtInput = listEl.querySelector(`[data-amt="${id}"]`);
        const amount = parseFloat(amtInput.value) || sp.defaultAmount;
        const ratio = sp.defaultAmount > 0 ? amount / sp.defaultAmount : 1;
        const l = getLog(state.currentDate);
        l.supplements.push({
          id: uid(), suppId: sp.id, name: sp.name, amount, unit: sp.unit,
          calories: round((sp.calories || 0) * ratio, 1),
          time: new Date().toISOString(),
        });
        saveDb();
        closeSheet();
        renderToday();
        toast('Logged ' + sp.name);
      });
    });
  }

  /* ---------------------------------------------------------------------
   * FOODS TAB
   * ------------------------------------------------------------------- */
  function renderFoods() {
    const list = document.getElementById('food-library-list');
    if (db.foods.length === 0) {
      list.innerHTML = '<div class="empty-msg">Your library is empty. Search above or create a manual food.</div>';
    } else {
      list.innerHTML = db.foods.slice().reverse().map((food) => `
        <div class="entry">
          <div class="entry-main">
            <div class="entry-title">${escapeHtml(food.name)}</div>
            <div class="entry-sub">${round(food.calories)} kcal · P${round(food.protein)} C${round(food.carbs)} F${round(food.fat)} / ${escapeHtml(food.servingLabel)}</div>
          </div>
          <button class="entry-remove" data-del-food="${food.id}" aria-label="Delete">×</button>
        </div>
      `).join('');
      list.querySelectorAll('[data-del-food]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.delFood;
          if (!confirm('Remove this food from your library? Past logged entries stay unchanged.')) return;
          db.foods = db.foods.filter((f) => f.id !== id);
          saveDb();
          renderFoods();
        });
      });
    }
  }

  function openManualFoodSheet(prefillBarcode) {
    openSheet(`
      <h3>Create manual food</h3>
      <label class="field">Name<input type="text" id="mf-name" placeholder="e.g. Grilled chicken breast"></label>
      <label class="field">Serving label<input type="text" id="mf-serving" placeholder="e.g. 1 breast (150g), 100 g, 1 scoop" value="1 serving"></label>
      <div class="field-row">
        <label class="field">Calories (kcal)<input type="number" id="mf-cal" min="0" step="1"></label>
        <label class="field">Protein (g)<input type="number" id="mf-protein" min="0" step="0.1"></label>
      </div>
      <div class="field-row">
        <label class="field">Carbs (g)<input type="number" id="mf-carbs" min="0" step="0.1"></label>
        <label class="field">Fat (g)<input type="number" id="mf-fat" min="0" step="0.1"></label>
      </div>
      ${prefillBarcode ? `<p class="muted">Barcode ${escapeHtml(prefillBarcode)} — not found in Open Food Facts, will be saved with this entry.</p>` : ''}
      <button class="btn-primary full-width" id="mf-save">Save food</button>
    `);
    document.getElementById('mf-save').addEventListener('click', () => {
      const name = document.getElementById('mf-name').value.trim();
      if (!name) { toast('Enter a name'); return; }
      const food = {
        id: uid(),
        name,
        servingLabel: document.getElementById('mf-serving').value.trim() || '1 serving',
        calories: parseFloat(document.getElementById('mf-cal').value) || 0,
        protein: parseFloat(document.getElementById('mf-protein').value) || 0,
        carbs: parseFloat(document.getElementById('mf-carbs').value) || 0,
        fat: parseFloat(document.getElementById('mf-fat').value) || 0,
        source: 'manual',
      };
      if (prefillBarcode) food.barcode = prefillBarcode;
      db.foods.push(food);
      saveDb();
      closeSheet();
      renderFoods();
      toast('Saved ' + name);
    });
  }
  document.getElementById('new-manual-food-btn').addEventListener('click', () => openManualFoodSheet());

  const RO_TAG = 'en:romania';
  function isRomaniaProduct(p) {
    return Array.isArray(p.countries_tags) && p.countries_tags.indexOf(RO_TAG) !== -1;
  }
  function offSearchUrl(query, extraParams) {
    return 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(query)
      + '&search_simple=1&action=process&json=1&page_size=24' + (extraParams || '');
  }
  function fetchOffSearch(url) {
    return fetch(url).then((res) => {
      if (!res.ok) throw new Error('bad response');
      return res.json();
    }).then((data) => (data.products || []).filter((p) => {
      const n = p.nutriments || {};
      return p.product_name && (n['energy-kcal_100g'] != null || n['energy-kcal_serving'] != null);
    }));
  }

  function searchFoodDb(query) {
    const statusEl = document.getElementById('food-search-status');
    const resultsEl = document.getElementById('food-search-results');
    statusEl.textContent = 'Searching…';
    resultsEl.innerHTML = '';

    // First try scoped to products tagged as sold in Romania; if that comes up empty
    // (Open Food Facts' Romanian coverage is patchy for some items), fall back to a
    // global search and just sort/badge the Romania-tagged ones to the top instead.
    const roUrl = offSearchUrl(query, '&tagtype_0=countries&tag_contains_0=contains&tag_0=romania');
    fetchOffSearch(roUrl)
      .catch(() => [])
      .then((roProducts) => {
        if (roProducts.length > 0) return { products: roProducts, scoped: true };
        return fetchOffSearch(offSearchUrl(query)).then((products) => ({ products, scoped: false }));
      })
      .then(({ products, scoped }) => {
        if (products.length === 0) {
          statusEl.textContent = 'No results found.';
          return;
        }
        if (!scoped) {
          products = products.slice().sort((a, b) => (isRomaniaProduct(b) ? 1 : 0) - (isRomaniaProduct(a) ? 1 : 0));
        }
        statusEl.textContent = products.length + ' result(s)'
          + (scoped ? ' available in Romania' : ' — 🇷🇴 marks ones tagged as sold in Romania')
          + ' — tap + to save to your library';
        resultsEl.innerHTML = products.slice(0, 24).map((p, idx) => {
          const n = p.nutriments || {};
          const kcal = round(n['energy-kcal_100g'] || 0);
          const protein = round(n['proteins_100g'] || 0, 1);
          const carbs = round(n['carbohydrates_100g'] || 0, 1);
          const fat = round(n['fat_100g'] || 0, 1);
          const brand = p.brands ? ' · ' + p.brands.split(',')[0] : '';
          const roBadge = isRomaniaProduct(p) ? ' 🇷🇴' : '';
          return `
            <div class="quick-add-item">
              <div class="qa-main">
                <div class="qa-title">${escapeHtml(p.product_name)}${escapeHtml(brand)}${roBadge}</div>
                <div class="qa-sub">${kcal} kcal · P${protein} C${carbs} F${fat} per 100g</div>
              </div>
              <button data-off-idx="${idx}">+</button>
            </div>`;
        }).join('');
        resultsEl.querySelectorAll('[data-off-idx]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const p = products[btn.dataset.offIdx];
            const n = p.nutriments || {};
            const food = {
              id: uid(),
              name: p.product_name + (p.brands ? ' (' + p.brands.split(',')[0] + ')' : ''),
              servingLabel: '100 g',
              calories: round(n['energy-kcal_100g'] || 0),
              protein: round(n['proteins_100g'] || 0, 1),
              carbs: round(n['carbohydrates_100g'] || 0, 1),
              fat: round(n['fat_100g'] || 0, 1),
              source: 'openfoodfacts',
              barcode: p.code || null,
            };
            db.foods.push(food);
            saveDb();
            toast('Saved to library');
            renderFoods();
          });
        });
      })
      .catch((e) => {
        console.error('searchFoodDb error', e);
        statusEl.textContent = 'Search failed — check your internet connection.';
      });
  }

  document.getElementById('food-search-btn').addEventListener('click', () => {
    const q = document.getElementById('food-search-input').value.trim();
    if (q) searchFoodDb(q);
  });
  document.getElementById('food-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) searchFoodDb(q);
    }
  });

  /* ---------------------------------------------------------------------
   * BARCODE SCANNER
   * Uses the native BarcodeDetector API against a live camera feed, with a
   * manual-entry fallback when that API (or camera access) isn't available.
   * ------------------------------------------------------------------- */
  let activeCameraStream = null;
  let scanning = false;
  let scanTimeoutId = null;

  function stopActiveCamera() {
    scanning = false;
    if (scanTimeoutId) { clearTimeout(scanTimeoutId); scanTimeoutId = null; }
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach((t) => t.stop());
      activeCameraStream = null;
    }
  }

  function renderManualBarcodeEntry(message) {
    const area = document.getElementById('scanner-area') || sheetContent;
    area.innerHTML = `
      ${message ? `<div class="empty-msg">${escapeHtml(message)}</div>` : ''}
      <label class="field">Barcode number<input type="text" inputmode="numeric" id="manual-barcode-input" placeholder="e.g. 5941234567890"></label>
      <button class="btn-primary full-width" id="manual-barcode-lookup">Look up</button>
    `;
    document.getElementById('manual-barcode-lookup').addEventListener('click', () => {
      const val = document.getElementById('manual-barcode-input').value.trim();
      if (!val) { toast('Enter a barcode number'); return; }
      lookupBarcodeAndShow(val);
    });
  }

  async function openBarcodeScanner() {
    openSheet(`
      <h3>Scan barcode</h3>
      <div id="scanner-area"></div>
      <button class="btn-secondary full-width" id="manual-barcode-toggle" style="margin-top:10px;">Enter barcode manually instead</button>
    `);
    document.getElementById('manual-barcode-toggle').addEventListener('click', () => {
      stopActiveCamera();
      renderManualBarcodeEntry();
    });

    if (!('BarcodeDetector' in window)) {
      renderManualBarcodeEntry("Barcode scanning isn't supported in this browser — enter the number instead.");
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    } catch (err) {
      renderManualBarcodeEntry("Couldn't access your camera — enter the barcode number instead.");
      return;
    }
    // The sheet may have been closed while we were waiting on the permission prompt.
    const area = document.getElementById('scanner-area');
    if (!area) { stream.getTracks().forEach((t) => t.stop()); return; }
    activeCameraStream = stream;

    area.innerHTML = `
      <div class="scanner-video-wrap">
        <video id="scanner-video" autoplay playsinline muted></video>
        <div class="scanner-frame"></div>
      </div>
      <div class="ai-spinner-row"><span class="spinner"></span> Point your camera at the barcode…</div>
    `;
    const video = document.getElementById('scanner-video');
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay quirks — ignore */ }

    let detector;
    try {
      detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
    } catch (e) {
      stopActiveCamera();
      renderManualBarcodeEntry("Barcode scanning isn't available on this device — enter the number instead.");
      return;
    }

    scanning = true;
    const tick = async () => {
      if (!scanning) return;
      const videoEl = document.getElementById('scanner-video');
      if (!videoEl) { scanning = false; return; }
      try {
        const codes = await detector.detect(videoEl);
        if (scanning && codes && codes.length > 0) {
          scanning = false;
          const value = codes[0].rawValue;
          stopActiveCamera();
          lookupBarcodeAndShow(value);
          return;
        }
      } catch (e) { /* transient decode error — keep trying */ }
      if (scanning) scanTimeoutId = setTimeout(tick, 350);
    };
    tick();
  }

  async function lookupBarcodeAndShow(barcode) {
    sheetContent.innerHTML = `<h3>Scan barcode</h3><div class="ai-spinner-row"><span class="spinner"></span> Looking up ${escapeHtml(barcode)}…</div>`;
    let product;
    try {
      const res = await fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(barcode) + '.json');
      if (!res.ok) throw new Error('lookup failed');
      const data = await res.json();
      if (!data || data.status !== 1 || !data.product) {
        renderBarcodeNotFound(barcode);
        return;
      }
      product = data.product;
    } catch (e) {
      sheetContent.innerHTML = `
        <h3>Scan barcode</h3>
        <div class="empty-msg">Couldn't look that up — check your internet connection.</div>
        <button class="btn-secondary full-width" id="barcode-retry-btn">Try again</button>
      `;
      document.getElementById('barcode-retry-btn').addEventListener('click', () => lookupBarcodeAndShow(barcode));
      return;
    }
    renderBarcodeProduct(product, barcode);
  }

  function renderBarcodeNotFound(barcode) {
    sheetContent.innerHTML = `
      <h3>Scan barcode</h3>
      <div class="empty-msg">No product found for barcode ${escapeHtml(barcode)} in Open Food Facts. You can still add it to your library by hand.</div>
      <button class="btn-primary full-width" id="barcode-manual-food-btn">Create manual food</button>
    `;
    document.getElementById('barcode-manual-food-btn').addEventListener('click', () => openManualFoodSheet(barcode));
  }

  function renderBarcodeProduct(product, barcode) {
    const n = product.nutriments || {};
    const kcal = round(n['energy-kcal_100g'] || 0);
    const protein = round(n['proteins_100g'] || 0, 1);
    const carbs = round(n['carbohydrates_100g'] || 0, 1);
    const fat = round(n['fat_100g'] || 0, 1);
    const name = (product.product_name || 'Unnamed product') + (product.brands ? ' (' + product.brands.split(',')[0] + ')' : '');
    const roBadge = isRomaniaProduct(product) ? ' 🇷🇴' : '';
    sheetContent.innerHTML = `
      <h3>Product found</h3>
      <div class="quick-add-item" style="margin-bottom:14px;">
        <div class="qa-main">
          <div class="qa-title">${escapeHtml(name)}${roBadge}</div>
          <div class="qa-sub">${kcal} kcal · P${protein} C${carbs} F${fat} per 100g</div>
        </div>
      </div>
      <label class="field">Grams eaten<input type="number" id="barcode-grams" min="1" step="1" value="100"></label>
      <button class="btn-primary full-width" id="barcode-save-btn">Save to library &amp; add to today</button>
      <button class="btn-secondary full-width" id="barcode-save-only-btn">Just save to library</button>
    `;
    function buildFood() {
      return { id: uid(), name, servingLabel: '100 g', calories: kcal, protein, carbs, fat, source: 'openfoodfacts', barcode: product.code || barcode };
    }
    document.getElementById('barcode-save-only-btn').addEventListener('click', () => {
      db.foods.push(buildFood());
      saveDb();
      closeSheet();
      if (state.activeTab === 'foods') renderFoods();
      toast('Saved to library');
    });
    document.getElementById('barcode-save-btn').addEventListener('click', () => {
      const grams = parseFloat(document.getElementById('barcode-grams').value) || 100;
      const ratio = grams / 100;
      const food = buildFood();
      db.foods.push(food);
      const l = getLog(state.currentDate);
      l.meals.push({
        id: uid(), foodId: food.id, name, qty: ratio, unitLabel: '100 g',
        calories: round(kcal * ratio, 1), protein: round(protein * ratio, 1),
        carbs: round(carbs * ratio, 1), fat: round(fat * ratio, 1),
        time: new Date().toISOString(),
      });
      saveDb();
      closeSheet();
      if (state.activeTab === 'today') renderToday();
      toast('Added ' + name);
    });
  }

  document.getElementById('scan-barcode-btn').addEventListener('click', () => openBarcodeScanner());

  /* ---------------------------------------------------------------------
   * SUPPLEMENTS TAB
   * ------------------------------------------------------------------- */
  function renderSupps() {
    const list = document.getElementById('supp-library-list');
    if (db.supplements.length === 0) {
      list.innerHTML = '<div class="empty-msg">No supplements yet — add creatine, ZMA, fish oil, etc.</div>';
      return;
    }
    list.innerHTML = db.supplements.slice().reverse().map((sp) => `
      <div class="entry">
        <div class="entry-main">
          <div class="entry-title">${escapeHtml(sp.name)}</div>
          <div class="entry-sub">default ${round(sp.defaultAmount, 2)} ${escapeHtml(sp.unit)}${sp.calories ? ' · ' + round(sp.calories) + ' kcal' : ''}</div>
        </div>
        <button class="entry-remove" data-del-supp="${sp.id}" aria-label="Delete">×</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-del-supp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.delSupp;
        if (!confirm('Remove this supplement from your library? Past logged entries stay unchanged.')) return;
        db.supplements = db.supplements.filter((s) => s.id !== id);
        saveDb();
        renderSupps();
      });
    });
  }

  document.getElementById('new-supp-btn').addEventListener('click', () => {
    openSheet(`
      <h3>New supplement</h3>
      <label class="field">Name<input type="text" id="sp-name" placeholder="e.g. Creatine monohydrate"></label>
      <div class="field-row">
        <label class="field">Default amount<input type="number" id="sp-amount" min="0" step="0.25" value="1"></label>
        <label class="field">Unit<input type="text" id="sp-unit" placeholder="g, capsules, scoops…" value="g"></label>
      </div>
      <label class="field">Calories (optional, if any)<input type="number" id="sp-cal" min="0" step="1" value="0"></label>
      <button class="btn-primary full-width" id="sp-save">Save supplement</button>
    `);
    document.getElementById('sp-save').addEventListener('click', () => {
      const name = document.getElementById('sp-name').value.trim();
      if (!name) { toast('Enter a name'); return; }
      db.supplements.push({
        id: uid(),
        name,
        defaultAmount: parseFloat(document.getElementById('sp-amount').value) || 1,
        unit: document.getElementById('sp-unit').value.trim() || 'unit',
        calories: parseFloat(document.getElementById('sp-cal').value) || 0,
      });
      saveDb();
      closeSheet();
      renderSupps();
      toast('Saved ' + name);
    });
  });

  /* ---------------------------------------------------------------------
   * HISTORY TAB (calorie chart, weight chart, past days list)
   * ------------------------------------------------------------------- */
  let calorieChart = null;
  let weightChart = null;

  function renderHistory() {
    // Chart rendering depends on the Chart.js CDN script having loaded successfully.
    // Never let that failure (e.g. no internet on first-ever load) block the rest of the tab.
    try { renderCalorieChart(); } catch (e) { console.warn('Calorie chart unavailable', e); showChartFallback('calorie-chart'); }
    try { renderWeightChart(); } catch (e) { console.warn('Weight chart unavailable', e); showChartFallback('weight-chart'); }
    renderHistoryList();
  }

  function showChartFallback(canvasId) {
    const canvas = document.getElementById(canvasId);
    const p = document.createElement('div');
    p.className = 'empty-msg';
    p.textContent = 'Chart unavailable offline right now — your data is still saved.';
    canvas.replaceWith(p);
  }

  function renderCalorieChart() {
    if (typeof Chart === 'undefined') throw new Error('Chart.js not loaded');
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(addDays(todayStr(), -i));
    const labels = days.map((d) => parseDateStr(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const values = days.map((d) => round(dayTotals(d).calories));
    const goal = db.settings.calorieGoal;

    const ctx = document.getElementById('calorie-chart').getContext('2d');
    if (calorieChart) calorieChart.destroy();
    calorieChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Calories',
            data: values,
            backgroundColor: values.map((v) => v > goal ? 'rgba(255,107,107,0.85)' : 'rgba(79,209,197,0.85)'),
            borderRadius: 4,
            order: 2,
          },
          {
            label: 'Goal',
            data: days.map(() => goal),
            type: 'line',
            borderColor: 'rgba(124,155,255,0.9)',
            borderDash: [5, 4],
            pointRadius: 0,
            borderWidth: 1.5,
            order: 1,
          }
        ]
      },
      options: chartBaseOptions(),
    });
  }

  function renderWeightChart() {
    if (typeof Chart === 'undefined') throw new Error('Chart.js not loaded');
    const entries = db.weight.slice().sort((a, b) => a.date.localeCompare(b.date));
    const ctx = document.getElementById('weight-chart').getContext('2d');
    if (weightChart) weightChart.destroy();
    if (entries.length === 0) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      weightChart = null;
      return;
    }
    weightChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: entries.map((e) => parseDateStr(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
        datasets: [{
          label: 'Weight (kg)',
          data: entries.map((e) => e.kg),
          borderColor: 'rgba(255,180,84,0.95)',
          backgroundColor: 'rgba(255,180,84,0.15)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        }]
      },
      options: chartBaseOptions(),
    });
  }

  function chartBaseOptions() {
    const grid = 'rgba(255,255,255,0.06)';
    const tick = '#8996b3';
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: grid }, ticks: { color: tick, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: grid }, ticks: { color: tick }, beginAtZero: true }
      }
    };
  }

  function renderHistoryList() {
    const dates = Object.keys(db.logs)
      .filter((d) => (db.logs[d].meals && db.logs[d].meals.length) || (db.logs[d].supplements && db.logs[d].supplements.length))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 30);
    const list = document.getElementById('history-list');
    if (dates.length === 0) {
      list.innerHTML = '<div class="empty-msg">No logged days yet.</div>';
      return;
    }
    list.innerHTML = dates.map((d) => {
      const t = dayTotals(d);
      return `
        <div class="entry" data-jump="${d}" style="cursor:pointer;">
          <div class="entry-main">
            <div class="entry-title">${formatDateLabel(d)}</div>
            <div class="entry-sub">P${round(t.protein)} C${round(t.carbs)} F${round(t.fat)}</div>
          </div>
          <div class="entry-cals">${round(t.calories)} kcal</div>
        </div>`;
    }).join('');
    list.querySelectorAll('[data-jump]').forEach((row) => {
      row.addEventListener('click', () => {
        state.currentDate = row.dataset.jump;
        switchTab('today');
      });
    });
  }

  document.getElementById('add-weight-btn').addEventListener('click', () => {
    openSheet(`
      <h3>Log weight</h3>
      <label class="field">Date<input type="date" id="wt-date" value="${todayStr()}"></label>
      <div class="field-row">
        <label class="field">Weight<input type="number" id="wt-value" min="0" step="0.1"></label>
        <label class="field">Unit
          <select id="wt-unit">
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </select>
        </label>
      </div>
      <button class="btn-primary full-width" id="wt-save">Save</button>
    `);
    document.getElementById('wt-save').addEventListener('click', () => {
      const date = document.getElementById('wt-date').value || todayStr();
      const raw = parseFloat(document.getElementById('wt-value').value);
      if (!raw || raw <= 0) { toast('Enter a weight'); return; }
      const unit = document.getElementById('wt-unit').value;
      const kg = unit === 'lb' ? round(raw * 0.453592, 2) : round(raw, 2);
      db.weight = db.weight.filter((w) => w.date !== date);
      db.weight.push({ date, kg });
      saveDb();
      closeSheet();
      renderHistory();
      toast('Weight logged');
    });
  });

  /* ---------------------------------------------------------------------
   * SETTINGS TAB
   * ------------------------------------------------------------------- */
  function renderSettings() {
    document.getElementById('goal-calories').value = db.settings.calorieGoal;
    document.getElementById('goal-protein').value = db.settings.proteinGoal;
    document.getElementById('goal-carbs').value = db.settings.carbsGoal;
    document.getElementById('goal-fat').value = db.settings.fatGoal;

    const ai = db.settings.ai;
    document.getElementById('ai-provider').value = ai.provider;
    document.getElementById('ai-gemini-key').value = ai.gemini.apiKey;
    document.getElementById('ai-gemini-model').value = ai.gemini.model;
    document.getElementById('ai-claude-key').value = ai.claude.apiKey;
    document.getElementById('ai-claude-model').value = ai.claude.model;
    toggleAiFieldVisibility();
  }

  function toggleAiFieldVisibility() {
    const provider = document.getElementById('ai-provider').value;
    document.getElementById('ai-gemini-fields').classList.toggle('hidden', provider !== 'gemini');
    document.getElementById('ai-claude-fields').classList.toggle('hidden', provider !== 'claude');
  }
  document.getElementById('ai-provider').addEventListener('change', toggleAiFieldVisibility);

  document.getElementById('save-goals-btn').addEventListener('click', () => {
    db.settings.calorieGoal = parseFloat(document.getElementById('goal-calories').value) || 0;
    db.settings.proteinGoal = parseFloat(document.getElementById('goal-protein').value) || 0;
    db.settings.carbsGoal = parseFloat(document.getElementById('goal-carbs').value) || 0;
    db.settings.fatGoal = parseFloat(document.getElementById('goal-fat').value) || 0;
    saveDb();
    toast('Goals saved');
  });

  document.getElementById('save-ai-btn').addEventListener('click', () => {
    const ai = db.settings.ai;
    ai.provider = document.getElementById('ai-provider').value;
    ai.gemini.apiKey = document.getElementById('ai-gemini-key').value.trim();
    ai.gemini.model = document.getElementById('ai-gemini-model').value.trim() || 'gemini-2.5-flash';
    ai.claude.apiKey = document.getElementById('ai-claude-key').value.trim();
    ai.claude.model = document.getElementById('ai-claude-model').value.trim() || 'claude-haiku-4-5-20251001';
    saveDb();
    toast('AI settings saved');
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    // Never let API keys leave the device in a backup file — strip them from the export.
    const exportObj = JSON.parse(JSON.stringify(db));
    if (exportObj.settings && exportObj.settings.ai) {
      if (exportObj.settings.ai.gemini) exportObj.settings.ai.gemini.apiKey = '';
      if (exportObj.settings.ai.claude) exportObj.settings.ai.claude.apiKey = '';
    }
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calorie-tracker-backup-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById('import-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object') throw new Error('bad file');
        if (!confirm('Import will replace all current data on this device. Continue?')) return;
        db = normalizeDb(parsed);
        saveDb();
        renderActiveTab();
        toast('Backup imported — note: API keys are never included in backups, so re-enter them here if you use AI photo recognition.');
      } catch (err) {
        toast('Invalid backup file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    if (!confirm('This permanently erases all foods, supplements, logs and weight entries on this device. This cannot be undone. Continue?')) return;
    if (!confirm('Are you absolutely sure? Consider exporting a backup first.')) return;
    db = defaultDb();
    saveDb();
    renderActiveTab();
    toast('All data erased');
  });

  /* ---------------------------------------------------------------------
   * AI PHOTO RECOGNITION
   * Calls the configured provider's API directly from the browser using the
   * user's own API key (never sent anywhere but that provider). No backend.
   * ------------------------------------------------------------------- */
  const AI_FOOD_PROMPT = 'You are a nutrition estimation assistant helping someone log food in a personal '
    + 'calorie tracker. Look at this photo and identify the distinct food/drink item(s) visible. For each '
    + 'item, estimate a realistic serving size based on what is visible and estimate its nutrition.\n\n'
    + 'Respond with ONLY raw JSON (no markdown, no code fences, no commentary), exactly matching this shape:\n'
    + '{"items":[{"name":"short food name","serving":"e.g. 1 bowl (~350g)","calories":number,"protein_g":number,'
    + '"carbs_g":number,"fat_g":number}],"confidence":"low"|"medium"|"high","notes":"one short sentence on any '
    + 'uncertainty, or empty string"}\n\n'
    + 'If you see multiple distinct foods, list each as a separate item. These are rough estimates for personal '
    + "tracking, not medical or clinical nutrition advice. If the image doesn't clearly show food, return "
    + '{"items":[],"confidence":"low","notes":"explain what you saw instead"}.';

  function compressImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file.type || file.type.indexOf('image/') !== 0) {
        reject(new Error('That file is not an image.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that photo.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not decode that photo.'));
        img.onload = () => {
          const maxDim = 1024;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
            else { width = Math.round(width * (maxDim / height)); height = maxDim; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          const base64 = dataUrl.split(',')[1];
          resolve({ base64, mimeType: 'image/jpeg', dataUrl });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function parseJsonLoose(text) {
    if (!text) throw new Error('The AI returned an empty response.');
    let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (e) { /* fall through */ }
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { /* fall through */ }
    }
    throw new Error("Couldn't understand the AI's response — try again.");
  }

  function friendlyApiError(status, provider) {
    if (status === 401 || status === 403) return provider + ' rejected your API key — check it in Settings.';
    if (status === 429) return provider + " rate limit reached — wait a moment and try again.";
    if (status >= 500) return provider + "'s servers had an error — try again shortly.";
    return provider + ' request failed (HTTP ' + status + ').';
  }

  async function callGeminiVision(base64, mimeType, apiKey, model) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
      + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
    const body = {
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: AI_FOOD_PROMPT }
      ] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
    };
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('Could not reach Gemini — check your internet connection.');
    }
    if (!res.ok) throw new Error(friendlyApiError(res.status, 'Gemini'));
    const data = await res.json();
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
    return parseJsonLoose(text);
  }

  async function callClaudeVision(base64, mimeType, apiKey, model) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
              { type: 'text', text: AI_FOOD_PROMPT }
            ]
          }]
        })
      });
    } catch (e) {
      throw new Error('Could not reach Claude — check your internet connection.');
    }
    if (!res.ok) throw new Error(friendlyApiError(res.status, 'Claude'));
    const data = await res.json();
    const text = Array.isArray(data.content) ? data.content.map((b) => b.text || '').join('') : '';
    return parseJsonLoose(text);
  }

  async function recognizeFoodPhoto(base64, mimeType) {
    const ai = db.settings.ai;
    if (ai.provider === 'gemini') {
      if (!ai.gemini.apiKey) throw new Error('Add your Gemini API key in Settings first.');
      return callGeminiVision(base64, mimeType, ai.gemini.apiKey, ai.gemini.model || 'gemini-2.5-flash');
    }
    if (ai.provider === 'claude') {
      if (!ai.claude.apiKey) throw new Error('Add your Claude API key in Settings first.');
      return callClaudeVision(base64, mimeType, ai.claude.apiKey, ai.claude.model || 'claude-haiku-4-5-20251001');
    }
    throw new Error('Turn on AI photo recognition in Settings first.');
  }

  function renderAiResults(result, dataUrl) {
    const items = Array.isArray(result && result.items) ? result.items : [];
    if (items.length === 0) {
      sheetContent.innerHTML = `
        <h3>Photo</h3>
        <div class="photo-preview-wrap"><img src="${dataUrl}" alt="Food photo"></div>
        <div class="empty-msg">${escapeHtml((result && result.notes) || "Couldn't identify any food in that photo.")}</div>
        <button class="btn-secondary full-width" id="ai-close-btn">Close</button>
      `;
      document.getElementById('ai-close-btn').addEventListener('click', closeSheet);
      return;
    }
    const rowsHtml = items.map((it, i) => `
      <div class="ai-result-item">
        <div class="ai-row-top">
          <input type="checkbox" data-ai-include="${i}" checked>
          <input type="text" data-ai-name="${i}" value="${escapeHtml(it.name || 'Food')}">
        </div>
        <div class="muted" style="margin-bottom:8px;font-size:12px;">${escapeHtml(it.serving || '')}</div>
        <div class="ai-macro-inputs">
          <label>Cal<input type="number" min="0" data-ai-cal="${i}" value="${round(it.calories || 0)}"></label>
          <label>Protein<input type="number" min="0" step="0.1" data-ai-protein="${i}" value="${round(it.protein_g || 0, 1)}"></label>
          <label>Carbs<input type="number" min="0" step="0.1" data-ai-carbs="${i}" value="${round(it.carbs_g || 0, 1)}"></label>
          <label>Fat<input type="number" min="0" step="0.1" data-ai-fat="${i}" value="${round(it.fat_g || 0, 1)}"></label>
        </div>
      </div>
    `).join('');
    sheetContent.innerHTML = `
      <h3>Review &amp; add</h3>
      <div class="photo-preview-wrap"><img src="${dataUrl}" alt="Food photo"></div>
      ${result.confidence ? `<div class="ai-confidence">AI confidence: ${escapeHtml(result.confidence)}${result.notes ? ' — ' + escapeHtml(result.notes) : ''}</div>` : ''}
      <div id="ai-results-list" style="margin-top:10px;">${rowsHtml}</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin:10px 0;">
        <input type="checkbox" id="ai-save-library" checked> Also save these to your food library
      </label>
      <button class="btn-primary full-width" id="ai-add-btn">Add checked items to today</button>
    `;
    document.getElementById('ai-add-btn').addEventListener('click', () => {
      const saveToLibrary = document.getElementById('ai-save-library').checked;
      const list = document.getElementById('ai-results-list');
      let addedCount = 0;
      items.forEach((_, i) => {
        const include = list.querySelector(`[data-ai-include="${i}"]`).checked;
        if (!include) return;
        const name = list.querySelector(`[data-ai-name="${i}"]`).value.trim() || 'Food';
        const calories = parseFloat(list.querySelector(`[data-ai-cal="${i}"]`).value) || 0;
        const protein = parseFloat(list.querySelector(`[data-ai-protein="${i}"]`).value) || 0;
        const carbs = parseFloat(list.querySelector(`[data-ai-carbs="${i}"]`).value) || 0;
        const fat = parseFloat(list.querySelector(`[data-ai-fat="${i}"]`).value) || 0;
        const servingLabel = (items[i] && items[i].serving) || '1 serving (AI estimate)';

        if (saveToLibrary) {
          db.foods.push({ id: uid(), name, servingLabel, calories, protein, carbs, fat, source: 'ai-photo' });
        }
        const l = getLog(state.currentDate);
        l.meals.push({
          id: uid(), foodId: null, name, qty: 1, unitLabel: servingLabel,
          calories: round(calories, 1), protein: round(protein, 1), carbs: round(carbs, 1), fat: round(fat, 1),
          time: new Date().toISOString(),
        });
        addedCount++;
      });
      saveDb();
      closeSheet();
      if (state.activeTab === 'today') renderToday();
      if (state.activeTab === 'foods') renderFoods();
      toast(addedCount > 0 ? 'Added ' + addedCount + ' item(s)' : 'Nothing selected');
    });
  }

  async function openPhotoReviewSheet(file) {
    openSheet(`
      <h3>Photo</h3>
      <div class="ai-spinner-row"><span class="spinner"></span> Preparing photo…</div>
    `);
    let compressed;
    try {
      compressed = await compressImageFile(file);
    } catch (err) {
      sheetContent.innerHTML = `<h3>Photo</h3><div class="empty-msg">${escapeHtml(err.message)}</div>`;
      return;
    }
    sheetContent.innerHTML = `
      <h3>Photo</h3>
      <div class="photo-preview-wrap"><img src="${compressed.dataUrl}" alt="Food photo"></div>
      <div class="ai-spinner-row"><span class="spinner"></span> Analyzing photo…</div>
    `;
    try {
      const result = await recognizeFoodPhoto(compressed.base64, compressed.mimeType);
      renderAiResults(result, compressed.dataUrl);
    } catch (err) {
      console.error(err);
      sheetContent.innerHTML = `
        <h3>Photo</h3>
        <div class="photo-preview-wrap"><img src="${compressed.dataUrl}" alt="Food photo"></div>
        <div class="empty-msg">${escapeHtml(err.message || 'Something went wrong analyzing the photo.')}</div>
        <button class="btn-secondary full-width" id="ai-retry-btn">Try again</button>
      `;
      document.getElementById('ai-retry-btn').addEventListener('click', () => openPhotoReviewSheet(file));
    }
  }

  document.getElementById('add-photo-btn').addEventListener('click', () => {
    const ai = db.settings.ai;
    const key = ai.provider === 'gemini' ? ai.gemini.apiKey : ai.provider === 'claude' ? ai.claude.apiKey : '';
    if (ai.provider === 'none' || !key) {
      toast('Set up AI photo recognition in Settings first');
      switchTab('settings');
      return;
    }
    document.getElementById('photo-input').click();
  });

  document.getElementById('photo-input').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) openPhotoReviewSheet(file);
  });

  /* ---------------------------------------------------------------------
   * PWA install prompt
   * ------------------------------------------------------------------- */
  let deferredInstallPrompt = null;
  const installBanner = document.getElementById('install-banner');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (localStorage.getItem('installBannerDismissed') !== '1') {
      installBanner.classList.remove('hidden');
    }
  });

  document.getElementById('install-btn').addEventListener('click', async () => {
    installBanner.classList.add('hidden');
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    }
  });
  document.getElementById('install-dismiss').addEventListener('click', () => {
    installBanner.classList.add('hidden');
    localStorage.setItem('installBannerDismissed', '1');
  });
  window.addEventListener('appinstalled', () => {
    installBanner.classList.add('hidden');
  });

  /* ---------------------------------------------------------------------
   * Service worker registration
   * ------------------------------------------------------------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch((err) => {
        console.warn('Service worker registration failed', err);
      });
    });
  }

  /* ---------------------------------------------------------------------
   * Init
   * ------------------------------------------------------------------- */
  switchTab('today');
})();
