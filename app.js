(function () {
  'use strict';

  /* ---------------------------------------------------------------------
   * Storage
   * ------------------------------------------------------------------- */
  const DB_KEY = 'calorieTrackerData';

  function defaultDb() {
    return {
      version: 1,
      settings: { calorieGoal: 2200, proteinGoal: 150, carbsGoal: 220, fatGoal: 70 },
      foods: [],
      supplements: [],
      logs: {},   // { 'YYYY-MM-DD': { meals: [...], supplements: [...] } }
      weight: []  // [{ date, kg }]
    };
  }

  function loadDb() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return defaultDb();
      const parsed = JSON.parse(raw);
      const d = defaultDb();
      return Object.assign(d, parsed, {
        settings: Object.assign(d.settings, parsed.settings || {}),
      });
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
    sheetContent.innerHTML = html;
    sheetEl.classList.remove('hidden');
    sheetBackdrop.classList.remove('hidden');
  }

  function closeSheet() {
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

  document.getElementById('new-manual-food-btn').addEventListener('click', () => {
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
      db.foods.push(food);
      saveDb();
      closeSheet();
      renderFoods();
      toast('Saved ' + name);
    });
  });

  function searchFoodDb(query) {
    const statusEl = document.getElementById('food-search-status');
    const resultsEl = document.getElementById('food-search-results');
    statusEl.textContent = 'Searching…';
    resultsEl.innerHTML = '';
    const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' +
      encodeURIComponent(query) + '&search_simple=1&action=process&json=1&page_size=20';
    fetch(url).then((res) => {
      if (!res.ok) throw new Error('bad response');
      return res.json();
    }).then((data) => {
      const products = (data.products || []).filter((p) => {
        const n = p.nutriments || {};
        return p.product_name && (n['energy-kcal_100g'] != null || n['energy-kcal_serving'] != null);
      });
      if (products.length === 0) {
        statusEl.textContent = 'No results found.';
        return;
      }
      statusEl.textContent = products.length + ' result(s) — tap + to save to your library';
      resultsEl.innerHTML = products.slice(0, 20).map((p, idx) => {
        const n = p.nutriments || {};
        const kcal = round(n['energy-kcal_100g'] || 0);
        const protein = round(n['proteins_100g'] || 0, 1);
        const carbs = round(n['carbohydrates_100g'] || 0, 1);
        const fat = round(n['fat_100g'] || 0, 1);
        const brand = p.brands ? ' · ' + p.brands.split(',')[0] : '';
        return `
          <div class="quick-add-item">
            <div class="qa-main">
              <div class="qa-title">${escapeHtml(p.product_name)}${escapeHtml(brand)}</div>
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
    }).catch(() => {
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
  }

  document.getElementById('save-goals-btn').addEventListener('click', () => {
    db.settings.calorieGoal = parseFloat(document.getElementById('goal-calories').value) || 0;
    db.settings.proteinGoal = parseFloat(document.getElementById('goal-protein').value) || 0;
    db.settings.carbsGoal = parseFloat(document.getElementById('goal-carbs').value) || 0;
    db.settings.fatGoal = parseFloat(document.getElementById('goal-fat').value) || 0;
    saveDb();
    toast('Goals saved');
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
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
        const d = defaultDb();
        db = Object.assign(d, parsed, { settings: Object.assign(d.settings, parsed.settings || {}) });
        saveDb();
        renderActiveTab();
        toast('Backup imported');
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
