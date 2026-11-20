// Общие UI-хелперы для страниц администратора и управляющего.
// Здесь живёт всё, что раньше было продублировано в admin.js и manager.js:
// карточки рейтинга союзов, синхронизация слайдеров подписей, кнопки тулбара.

import { getSelected, getLabelSettings } from './map-core.js';
import { pickUniqueColor } from './palette.js';
import { escapeHtml, setControlsEnabled } from './utils.js';
import {
  DEFAULT_LABEL_CFG, FS_TOOL_BTN, TOOL_BTN, TERRITORY_TYPES,
} from './constants.js';

const CITY_RES_IMG = 'assets/season_resource_city.png';
const BASTION_RES_IMG = 'assets/season_resource.png';

// ═══════════════════════════════════════════════════════════════
// РЕНДЕР РЕЙТИНГА СОЮЗОВ
// ═══════════════════════════════════════════════════════════════

function incomeLine(inc, size) {
  if (!(inc.city > 0 || inc.bastion > 0)) return '';
  return `
    <div class="text-[10px] flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
      ${inc.city > 0 ? `<span class="flex items-center gap-1 text-amber-600 dark:text-amber-400"><img src="${CITY_RES_IMG}" class="${size} inline align-middle" onerror="this.style.display='none'"> ${inc.city} в час</span>` : ''}
      ${inc.bastion > 0 ? `<span class="flex items-center gap-1 text-cyan-600 dark:text-cyan-400"><img src="${BASTION_RES_IMG}" class="${size} inline align-middle" onerror="this.style.display='none'"> ${inc.bastion} в час</span>` : ''}
    </div>`;
}

function statsLine(s) {
  return `
    <div class="text-[10px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
      <span><b class="text-gray-700 dark:text-gray-200">${s.total}</b> всего</span>
      <span>Б:<b class="text-gray-700 dark:text-gray-200">${s.bastions}</b></span>
      <span>Г:<b class="text-gray-700 dark:text-gray-200">${s.general}</b></span>
      <span>Т:<b class="text-gray-700 dark:text-gray-200">${s.trade}</b></span>
    </div>`;
}

function actionButtons(a, i, total, pad) {
  return `
    <button class="rank-up text-blue-500 ${pad} disabled:opacity-30" data-id="${a.id}" ${i === 0 ? 'disabled' : ''}><i class="fas fa-arrow-up"></i></button>
    <button class="rank-down text-blue-500 ${pad} disabled:opacity-30" data-id="${a.id}" ${i === total - 1 ? 'disabled' : ''}><i class="fas fa-arrow-down"></i></button>
    <button class="edit-alliance text-yellow-600 ${pad}" data-id="${a.id}"><i class="fas fa-pen"></i></button>
    <button class="del-alliance text-red-500 ${pad}" data-id="${a.id}"><i class="fas fa-trash"></i></button>`;
}

/** Кнопка «показать территории союза на карте». */
function showOnMapButton(a, pad, kind) {
  const isFlash = kind === 'flash';
  const title = isFlash ? 'Показать территории на карте' : 'Выделить территории союза';
  const cls = isFlash ? 'show-on-map text-sky-600' : 'select-alliance-territories text-sky-600';
  return `<button class="${cls} ${pad}" data-id="${a.id}" title="${title}"><i class="fas fa-${isFlash ? 'crosshairs' : 'object-group'}"></i></button>`;
}

/**
 * Одна строка/карточка союза.
 * layout 'card' — крупная карточка (manager), 'row' — компактная строка (admin).
 * showOnMap: 'flash' — мигающая обводка (гость), 'select' — выделение (управляющий).
 */
function allianceItemHtml(a, i, total, s, inc, layout, actions = true, showOnMap = null) {
  const tag = escapeHtml(a.tag);
  const name = escapeHtml(a.name || '');
  const pad = layout === 'row' ? 'px-0.5' : 'px-1';
  const buttons = actions ? actionButtons(a, i, total, pad) : '';
  const mapBtn = showOnMap ? showOnMapButton(a, pad, showOnMap) : '';
  if (layout === 'row') {
    return `
      <div class="flex items-center gap-1 py-1.5 border-b dark:border-gray-700 text-xs">
        <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${a.color}"></span>
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-1">
            <span class="text-gray-500">${i + 1}.</span>
            <span class="font-mono font-semibold">${tag}</span>
            <span class="text-gray-500 truncate">${name}</span>
          </div>
          ${statsLine(s)}
          ${incomeLine(inc, 'w-3 h-3')}
        </div>
        ${mapBtn}
        ${buttons}
      </div>`;
  }
  return `
    <div class="flex items-center gap-1 p-2 bg-white dark:bg-gray-800 rounded shadow-sm border dark:border-gray-700">
      <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${a.color}"></span>
      <span class="font-bold w-6 text-sm">${i + 1}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-1">
          <span class="font-mono font-semibold text-sm">${tag}</span>
          <span class="text-xs text-gray-500 truncate">${name}</span>
        </div>
        ${statsLine(s)}
        ${incomeLine(inc, 'w-3.5 h-3.5')}
      </div>
      ${mapBtn}
      ${buttons}
    </div>`;
}

/**
 * Рисует рейтинг союзов и вешает обработчики.
 * @param {HTMLElement|string} container
 * @param {Array} alliances
 * @param {{stats:Object, incomes:Object, layout?:'card'|'row', actions?:boolean, emptyText?:string,
 *          showOnMap?:'flash'|'select'|null,
 *          onMoveRank?:Function, onEdit?:Function, onDelete?:Function,
 *          onShowOnMap?:Function}} options
 */
export function renderAlliancesRanking(container, alliances, options = {}) {
  const list = typeof container === 'string' ? document.getElementById(container) : container;
  if (!list) return;
  const {
    stats = {}, incomes = {}, layout = 'card', actions = true,
    emptyText = 'Нет союзов', showOnMap = null,
  } = options;

  if (!alliances.length) {
    list.innerHTML = `<p class="text-center text-gray-500 py-2 text-sm">${emptyText}</p>`;
    return;
  }

  list.innerHTML = alliances.map((a, i) => {
    const s = stats[a.id] || { bastions: 0, general: 0, trade: 0, total: 0 };
    const inc = incomes[a.id] || { city: 0, bastion: 0 };
    return allianceItemHtml(a, i, alliances.length, s, inc, layout, actions, showOnMap);
  }).join('');

  if (showOnMap) {
    bind(list, {
      '.show-on-map': (b) => options.onShowOnMap?.(b.dataset.id, 'flash'),
      '.select-alliance-territories': (b) => options.onShowOnMap?.(b.dataset.id, 'select'),
    });
  }

  if (!actions) return;

  bind(list, {
    '.rank-up': (b) => options.onMoveRank?.(b.dataset.id, -1),
    '.rank-down': (b) => options.onMoveRank?.(b.dataset.id, 1),
    '.edit-alliance': (b) => options.onEdit?.(b.dataset.id),
    '.del-alliance': (b) => options.onDelete?.(b.dataset.id),
  });
}

// Делегирование кликов по набору селекторов внутри контейнера
export function bind(container, handlers) {
  Object.entries(handlers).forEach(([selector, fn]) => {
    container.querySelectorAll(selector).forEach((el) => el.addEventListener('click', () => fn(el)));
  });
}

// ═══════════════════════════════════════════════════════════════
// SELECT СОЮЗА (основной + полноэкранный)
// ═══════════════════════════════════════════════════════════════

export function renderAllianceSelect(alliances, selectedId = null, ids = ['alliance-select', 'fs-alliance-select']) {
  const options = '<option value="">— Выберите —</option>' +
    alliances.map((a) => `<option value="${a.id}">${escapeHtml(a.tag)}${a.name ? ' — ' + escapeHtml(a.name) : ''}</option>`).join('');

  ids.forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = options;
    const keep = alliances.some((a) => a.id === cur) ? cur : null;
    const target = alliances.some((a) => a.id === selectedId) ? selectedId : keep;
    sel.value = target || '';
  });
}

// ═══════════════════════════════════════════════════════════════
// СЛАЙДЕРЫ ПОДПИСЕЙ (основная панель + fullscreen)
// ═══════════════════════════════════════════════════════════════

const SLIDER_PAIRS = [
  { main: 'lbl-dx', fs: 'fs-lbl-dx', get: (c) => c.dx || DEFAULT_LABEL_CFG.dx },
  { main: 'lbl-dy', fs: 'fs-lbl-dy', get: (c) => c.dy || DEFAULT_LABEL_CFG.dy },
  { main: 'lbl-rot', fs: 'fs-lbl-rot', get: (c) => c.rotation || DEFAULT_LABEL_CFG.rotation },
  { main: 'lbl-scale', fs: 'fs-lbl-scale', get: (c) => c.scale || DEFAULT_LABEL_CFG.scale },
];

const RESET_SLIDERS = ['btn-reset-labels', 'fs-btn-reset-labels'];

/**
 * Заносит настройки первой выбранной территории в слайдеры обеих панелей.
 * @param {{fs?:boolean, enabled?:boolean, panelId?:string, disableWhenEmpty?:boolean}} opts
 */
export function syncLabelSliders(opts = {}) {
  const { fs = true, enabled = true, panelId = null, disableWhenEmpty = false } = opts;
  const ids = getSelected();
  const hasSelection = ids.length > 0;
  const cfg = hasSelection ? (getLabelSettings()[ids[0]] || {}) : {};
  const live = hasSelection && enabled;

  SLIDER_PAIRS.forEach(({ main, fs: fsId, get }) => {
    const value = get(cfg);
    const mainEl = document.getElementById(main);
    if (mainEl) {
      if (hasSelection) mainEl.value = value;
      if (disableWhenEmpty) mainEl.disabled = !live;
    }
    if (fs) {
      const fsEl = document.getElementById(fsId);
      if (fsEl && hasSelection) fsEl.value = value;
    }
  });

  RESET_SLIDERS.forEach((id) => {
    const el = document.getElementById(id);
    if (el && disableWhenEmpty) el.disabled = !live;
  });

  if (panelId) setControlsEnabled(document.getElementById(panelId), enabled);
  return hasSelection;
}

// ═══════════════════════════════════════════════════════════════
// ОБЩИЕ ДЕЙСТВИЯ НАД ПОДПИСями ВЫБРАННЫХ ТЕРРИТОРИЙ
// ═══════════════════════════════════════════════════════════════

/** Меняет настройки подписей всех выбранных территорий через mutator. */
export function patchSelectedLabels(mutator) {
  const ids = getSelected();
  if (!ids.length) return null;
  const settings = getLabelSettings();
  ids.forEach((id) => {
    settings[id] = mutator({ ...(settings[id] || DEFAULT_LABEL_CFG) });
  });
  return { ids, settings };
}

/** Сбрасывает настройки подписей перечисленных территорий. */
export function resetLabelCfg(settings, ids) {
  ids.forEach((id) => { settings[id] = { ...DEFAULT_LABEL_CFG }; });
  return settings;
}

// ═══════════════════════════════════════════════════════════════
// ПЕРЕМЕШИВАНИЕ ЦВЕТОВ
// ═══════════════════════════════════════════════════════════════

export function shuffleAllianceColors(alliances) {
  const used = [];
  alliances.forEach((a) => {
    a.color = pickUniqueColor(used);
    used.push(a.color);
  });
  return alliances;
}

// ═══════════════════════════════════════════════════════════════
// КНОПКИ ТУЛБАРА (подписи / иконки / скрытый текст)
// ═══════════════════════════════════════════════════════════════

const TOOL_ON = { labels: TOOL_BTN.labelsOn, icons: TOOL_BTN.iconsOn, hidden: TOOL_BTN.hiddenOn };

/**
 * Перекрашивает кнопку основной панели.
 * Классы задаются через className целиком: TOOL_BTN.off содержит два класса
 * через пробел, а classList.toggle() так применять их не умеет.
 */
export function paintToolButton(btn, active, { kind = 'labels' } = {}) {
  if (!btn) return;
  btn.className = `${TOOL_BTN.base} ${active ? (TOOL_ON[kind] || TOOL_BTN.labelsOn) : TOOL_BTN.off}`;
}

/** Полный перекрас FS-кнопки «Подписи» / «Иконки». */
export function paintFsToolButton(btn, active, onClass) {
  if (!btn) return;
  btn.className = `${FS_TOOL_BTN.base} ${active ? onClass : FS_TOOL_BTN.off}`;
}

// ═══════════════════════════════════════════════════════════════
// ФИЛЬТРЫ ТЕРРИТОРИЙ (используются менеджером)
// ═══════════════════════════════════════════════════════════════

export function initFilterState() {
  const filters = {};
  for (const [t, cfg] of Object.entries(TERRITORY_TYPES)) {
    if (cfg.subs) {
      filters[t] = {};
      cfg.levels.forEach((l) => { filters[t][l] = true; });
    } else {
      filters[t] = true;
    }
  }
  return filters;
}

export function setAllFilters(filters, value) {
  for (const [t, cfg] of Object.entries(TERRITORY_TYPES)) {
    if (cfg.subs) {
      if (!filters[t]) filters[t] = {};
      cfg.levels.forEach((l) => { filters[t][l] = value; });
    } else {
      filters[t] = value;
    }
  }
  return filters;
}

export function renderFilterControls(container, filters, onChange) {
  const list = typeof container === 'string' ? document.getElementById(container) : container;
  if (!list) return;
  let html = '';
  for (const [t, cfg] of Object.entries(TERRITORY_TYPES)) {
    if (cfg.subs) {
      const sub = filters[t] || {};
      html += `
        <div class="mb-2">
          <label class="flex items-center font-semibold mb-1">
            <input type="checkbox" class="filter-group mr-2" data-type="${t}" ${Object.values(sub).some((v) => v) ? 'checked' : ''}>
            ${cfg.label}
          </label>
          <div class="ml-5 space-y-0.5">
            ${cfg.levels.map((l) => `
              <label class="flex items-center">
                <input type="checkbox" class="filter-level mr-2" data-type="${t}" data-level="${l}" ${sub[l] ? 'checked' : ''}>
                ${cfg.label} ${l} ур.
              </label>`).join('')}
          </div>
        </div>`;
    } else {
      html += `<label class="flex items-center mb-1"><input type="checkbox" class="filter-flat mr-2" data-type="${t}" ${filters[t] ? 'checked' : ''}>${cfg.label}</label>`;
    }
  }
  list.innerHTML = html;

  list.querySelectorAll('.filter-flat').forEach((cb) => {
    cb.addEventListener('change', () => { filters[cb.dataset.type] = cb.checked; onChange(); });
  });
  list.querySelectorAll('.filter-group').forEach((cb) => {
    cb.addEventListener('change', () => {
      const t = cb.dataset.type;
      if (!filters[t]) filters[t] = {};
      TERRITORY_TYPES[t].levels.forEach((l) => { filters[t][l] = cb.checked; });
      renderFilterControls(list, filters, onChange);
      onChange();
    });
  });
  list.querySelectorAll('.filter-level').forEach((cb) => {
    cb.addEventListener('change', () => {
      const t = cb.dataset.type;
      if (!filters[t]) filters[t] = {};
      filters[t][cb.dataset.level] = cb.checked;
      onChange();
    });
  });
}
