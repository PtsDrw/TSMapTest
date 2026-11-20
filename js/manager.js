import { db } from './firebase-config.js';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, addDoc,
  serverTimestamp, getDoc,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  initTheme, toast, nowString, formatDate, setMeta, customConfirm,
  openModal, closeModal, on, escapeHtml, createAllianceId, validateTag,
  renumberRanks, sortByRank,
} from './utils.js';
import {
  initMap, exportMapPNG, getLabelSettings, setLabelSettings, saveLabelSettings,
  selectTerritory, getSelected, clearSelection, selectAllFiltered, getFilteredTerritories,
  getTerritoryType, getTerritoryLevel, setPreviewData, canSelectWithAdjacency,
  setupLabelsToggle, setupUnassignedIconsToggle,
  computeAllianceStats, computeAllianceIncomes,
  isLabelsVisible, isUnassignedIconsVisible,
  isHiddenLabelsVisible, toggleHiddenLabelsExternal,
  setDragMode, setLabelEditMode as setLabelEditModeCore,
} from './map-core.js';
import { requireAuth, logout } from './auth.js';
import { pickUniqueColor } from './palette.js';
import {
  renderAlliancesRanking, renderAllianceSelect, syncLabelSliders,
  patchSelectedLabels, resetLabelCfg, shuffleAllianceColors,
  initFilterState, setAllFilters, renderFilterControls,
} from './common-ui.js';
import {
  createFsPanel, setFsPanelVisible, syncFsMode, syncFsAdjacency, syncFsLimits,
} from './fs-panel.js';
import {
  MODES, CITY_TYPES, DEFAULT_LIMITS, LAYOUT_STATUS, STORAGE_KEYS, ARCADIA_ID,
} from './constants.js';

/* ═══════════════════════════════════════════════════════════════
   СОСТОЯНИЕ
   ═══════════════════════════════════════════════════════════════ */

let session = null;
let mode = MODES.territoryToAlliance;
let selectedAllianceId = null;
let workingAlliances = [];
let workingAssignments = {};
let filters = {};
let savedLayoutId = null;
let mapReady = false;
let editingAllianceId = null;
let labelEditMode = false;
let isMultiSelect = false;

let adjacencyMode = false;
let respectLimits = false;
let limitCities = DEFAULT_LIMITS.cities;
let limitBastions = DEFAULT_LIMITS.bastions;
let limitTradePosts = DEFAULT_LIMITS.trade;

const sessionKey = () => STORAGE_KEYS.working(session.keyId);

/** Пишет строку в статус-баннер страницы. */
function addStatus(msg, ok = true) {
  const banner = document.getElementById('status-banner');
  const list = document.getElementById('status-list');
  if (!banner || !list) { console.log(`[STATUS ${ok ? 'OK' : 'ERR'}] ${msg}`); return; }
  banner.classList.remove('hidden');
  const li = document.createElement('li');
  li.textContent = msg;
  li.style.color = ok ? '#166534' : '#991b1b';
  list.appendChild(li);
}

/* ═══════════════════════════════════════════════════════════════
   СТАРТ
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  addStatus('✓ JS-модуль manager.js загружен');

  session = requireAuth(['manager']);
  if (!session) { addStatus('✗ Не авторизован', false); return; }
  addStatus(`✓ Сессия: ${session.name}${session.isMainManager ? ' (Главный)' : ''}`);

  filters = initFilterState();
  addStatus('✓ Фильтры инициализированы');

  try { initUIBindings(); addStatus('✓ Обработчики кнопок привязаны'); }
  catch (e) { addStatus('✗ Ошибка привязки UI: ' + e.message, false); console.error(e); return; }

  try { initTheme(); addStatus('✓ Тема инициализирована'); }
  catch (e) { addStatus('✗ Ошибка темы: ' + e.message, false); }

  document.getElementById('user-name').textContent = session.name || 'Управляющий';
  if (!session.isMainManager) document.getElementById('btn-approve-text').textContent = 'На утверждение';
  else document.getElementById('user-badge').classList.remove('hidden');

  try {
    const res = await initMap({
      containerId: 'map-container',
      interactive: true,
      clickHandler: onTerritoryClick,
      onFullscreenEditToggle: (active) => setFsPanelVisible(active, { onShown: updateSlidersFromSelection }),
    });
    if (!res) {
      addStatus('✗ Карта НЕ загружена', false);
      toast('Карта не загружена', 'error');
      return;
    }
    mapReady = true;
    initFsPanel();
    addStatus('✓ Карта загружена');
  } catch (e) {
    addStatus('✗ Ошибка карты: ' + e.message, false); console.error(e); return;
  }

  try {
    await loadCurrentState();
    addStatus(`✓ Данные загружены: ${workingAlliances.length} союзов, ${Object.keys(workingAssignments).length} назначений`);
    syncLimitUI();
  } catch (e) {
    addStatus('✗ Ошибка данных: ' + e.message, false); console.error(e);
    toast('Ошибка данных: ' + e.message, 'error');
  }

  try { renderAll(); addStatus('✓ Карта отрисована'); }
  catch (e) { addStatus('✗ Ошибка отрисовки: ' + e.message, false); console.error(e); }
});

/* ═══════════════════════════════════════════════════════════════
   РАБОЧИЕ ДАННЫЕ (sessionStorage + Firestore)
   ═══════════════════════════════════════════════════════════════ */

async function loadCurrentState() {
  const stored = sessionStorage.getItem(sessionKey());
  if (stored) {
    try {
      const s = JSON.parse(stored);
      workingAlliances = s.alliances || [];
      workingAssignments = s.assignments || {};
      savedLayoutId = s.layoutId || null;
      if (s.limits) {
        limitCities = s.limits.cities ?? DEFAULT_LIMITS.cities;
        limitBastions = s.limits.bastions ?? DEFAULT_LIMITS.bastions;
        limitTradePosts = s.limits.trade ?? DEFAULT_LIMITS.trade;
        respectLimits = s.limits.respect ?? false;
      }
      applyWorking();
      return;
    } catch { /* повреждённый снимок — перечитываем из Firestore */ }
  }

  const al = await getDocs(collection(db, 'alliances'));
  workingAlliances = [];
  al.forEach((d) => workingAlliances.push({ id: d.id, ...d.data() }));
  sortByRank(workingAlliances);

  const tt = await getDocs(collection(db, 'territories'));
  workingAssignments = {};
  tt.forEach((d) => { workingAssignments[d.id] = d.data().allianceId; });

  applyWorking();
}

function saveWorkingToSession() {
  sessionStorage.setItem(sessionKey(), JSON.stringify({
    alliances: workingAlliances,
    assignments: workingAssignments,
    layoutId: savedLayoutId,
    limits: {
      cities: limitCities,
      bastions: limitBastions,
      trade: limitTradePosts,
      respect: respectLimits,
    },
  }));
}

function applyWorking() {
  setPreviewData(
    Object.fromEntries(workingAlliances.map((a) => [a.id, a])),
    workingAssignments,
  );
}

/* ═══════════════════════════════════════════════════════════════
   ЛИМИТЫ
   ═══════════════════════════════════════════════════════════════ */

function parseLimitInput(val) {
  if (val === undefined || val === null) return Infinity;
  const s = String(val).trim();
  if (s === '' || s === '∞' || s.toLowerCase() === 'infinity') return Infinity;
  const num = parseInt(s, 10);
  return isNaN(num) ? Infinity : Math.max(0, num);
}

function countAllianceTerritories(aid) {
  let cities = 0, bastions = 0, trade = 0;
  for (const [tid, a] of Object.entries(workingAssignments)) {
    if (a !== aid) continue;
    const t = getTerritoryType(tid);
    if (t === 'B') bastions++;
    else if (t === 'T') trade++;
    else cities++;
  }
  return { cities, bastions, trade };
}

/** Разливает лимиты по обеим панелям (основной input'ы + FS-панель). */
function syncLimitUI() {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val === Infinity ? '∞' : val;
  };
  setVal('limit-cities', limitCities);
  setVal('limit-bastions', limitBastions);
  setVal('limit-trade', limitTradePosts);

  const chk = document.getElementById('chk-respect-limits');
  if (chk) chk.checked = respectLimits;

  syncFsLimits({ cities: limitCities, bastions: limitBastions, trade: limitTradePosts, respect: respectLimits });
}

/** Возвращает текст ошибки, если назначение `tid` союзу нарушает лимиты. */
function limitErrorFor(aid, tid) {
  const counts = countAllianceTerritories(aid);
  const type = getTerritoryType(tid);
  if (type === 'B' && counts.bastions >= limitBastions) {
    return `Лимит бастионов для этого союза достигнут (${limitBastions})`;
  }
  if (type === 'T' && counts.trade >= limitTradePosts) {
    return `Лимит торговых постов для этого союза достигнут (${limitTradePosts})`;
  }
  if (CITY_TYPES.includes(type) && counts.cities >= limitCities) {
    return `Лимит городов для этого союза достигнут (${limitCities})`;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   КЛИК ПО ТЕРРИТОРИИ
   ═══════════════════════════════════════════════════════════════ */

function onTerritoryClick(id, el) {
  if (!mapReady) return;
  if (id === ARCADIA_ID) return;
  if (!territoryPassesFilter(id)) { toast('Территория скрыта фильтрами', 'error'); return; }

  // В режиме надписей только выделяем территории
  if (labelEditMode) {
    const isSel = el.classList.contains('selected');
    if (!isMultiSelect) {
      clearSelection();
      if (!isSel) selectTerritory(id, true);
    } else {
      selectTerritory(id, !isSel);
    }
    updateSlidersFromSelection();
    return;
  }

  if (mode === MODES.territoryToAlliance) {
    const isSel = el.classList.contains('selected');
    if (!isSel && adjacencyMode && !canSelectWithAdjacency(id, getSelected(), true)) {
      toast('Можно выбирать только соседние территории', 'error');
      return;
    }
    selectTerritory(id, !isSel);
    updateSlidersFromSelection();
    return;
  }

  // Режим «Союз → Территории»
  if (!selectedAllianceId) { toast('Сначала выберите союз', 'error'); return; }

  const isRemoving = workingAssignments[id] === selectedAllianceId;
  if (!isRemoving) {
    if (respectLimits) {
      const error = limitErrorFor(selectedAllianceId, id);
      if (error) { toast(error, 'error'); return; }
    }
    if (adjacencyMode) {
      const allianceTerrs = Object.keys(workingAssignments).filter((k) => workingAssignments[k] === selectedAllianceId);
      if (allianceTerrs.length > 0 && !canSelectWithAdjacency(id, allianceTerrs, true)) {
        toast('Территория должна граничить с уже назначенными территориями этого союза', 'error');
        return;
      }
    }
    workingAssignments[id] = selectedAllianceId;
  } else {
    delete workingAssignments[id];
  }

  applyWorking();
  saveWorkingToSession();
  renderAlliancesList();
}

function territoryPassesFilter(id) {
  const type = getTerritoryType(id);
  if (type === 'B' || type === 'T') {
    const level = getTerritoryLevel(id);
    return !!(filters[type] && filters[type][level]);
  }
  return !!filters[type];
}

function highlightFiltered() {
  document.querySelectorAll('.territory').forEach((t) => {
    if (t.id === ARCADIA_ID) return;
    t.style.opacity = territoryPassesFilter(t.id) ? '' : '0.25';
  });
}

/* ═══════════════════════════════════════════════════════════════
   НАЗНАЧЕНИЕ СОЮЗА ВЫБРАННЫМ ТЕРРИТОРИЯМ
   ═══════════════════════════════════════════════════════════════ */

function applyAllianceToSelected(silent = false) {
  const fail = (msg) => { if (!silent) toast(msg, 'error'); return null; };

  if (!selectedAllianceId) return fail('Выберите союз из списка');
  const sel = getSelected();
  if (!sel.length) return fail('Сначала выберите территории кликом на карте');
  const alliance = workingAlliances.find((a) => a.id === selectedAllianceId);
  if (!alliance) return fail('Союз не найден');

  if (respectLimits) {
    const counts = countAllianceTerritories(selectedAllianceId);
    let addCities = 0, addBastions = 0, addTrade = 0;
    sel.forEach((id) => {
      if (workingAssignments[id] === selectedAllianceId) return;
      const type = getTerritoryType(id);
      if (type === 'B') addBastions++;
      else if (type === 'T') addTrade++;
      else addCities++;
    });

    if (counts.bastions + addBastions > limitBastions) return fail(`Превышен лимит бастионов (${limitBastions})`);
    if (counts.trade + addTrade > limitTradePosts) return fail(`Превышен лимит торговых постов (${limitTradePosts})`);
    if (counts.cities + addCities > limitCities) return fail(`Превышен лимит городов (${limitCities})`);
  }

  sel.forEach((id) => { workingAssignments[id] = selectedAllianceId; });
  clearSelection();
  applyWorking();
  saveWorkingToSession();
  renderAlliancesList();
  toast(`Назначено: ${sel.length} → ${alliance.tag}`, 'success');
}

/* ═══════════════════════════════════════════════════════════════
   РЕЖИМЫ И ВЫБОР СОЮЗА
   ═══════════════════════════════════════════════════════════════ */

function setMode(newMode) {
  mode = newMode;
  syncFsMode(newMode);
  clearSelection();
  renderAll();
  updateModeUI();
}

function setSelectedAlliance(id) {
  selectedAllianceId = id;
  ['alliance-select', 'fs-alliance-select'].forEach((elId) => {
    const el = document.getElementById(elId);
    if (el) el.value = id || '';
  });
}

function setAdjacencyMode(val) {
  adjacencyMode = val;
  syncFsAdjacency(val);
}

function updateModeUI() {
  const isTerritoryMode = mode === MODES.territoryToAlliance;
  ['selection-controls', 'btn-clear-selected', 'fs-selection-controls', 'fs-btn-clear-selected']
    .forEach((id) => document.getElementById(id)?.classList.toggle('hidden', !isTerritoryMode));
}

/* ═══════════════════════════════════════════════════════════════
   РЕЖИМ НАДПИСЕЙ / ПЕРЕТАСКИВАНИЕ / СЛАЙДЕРЫ
   ═══════════════════════════════════════════════════════════════ */

/** Единая точка синхронизации слайдеров обеих панелей. */
function updateSlidersFromSelection() {
  syncLabelSliders({ panelId: 'label-controls-panel', disableWhenEmpty: true, enabled: labelEditMode });
}
window.updateSlidersFromSelection = updateSlidersFromSelection;

/** Включает/выключает перетаскивание; false — если режим надписей не активен. */
function enableDragDrop(val) {
  if (val && !labelEditMode) {
    toast('Сначала включите «Режим редактирования надписей»', 'info');
    return false;
  }
  setDragMode(val);
  const fsDD = document.getElementById('fs-chk-drag-drop');
  if (fsDD) fsDD.checked = val;
  return true;
}

/** Переключает режим подписей из любого источника (главная или FS-панель). */
function setLabelEditMode(val) {
  labelEditMode = val;
  setLabelEditModeCore();

  ['chk-edit-labels-mode', 'fs-chk-edit-labels'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = val;
  });
  if (!val) enableDragDrop(false);

  clearSelection();
  updateSlidersFromSelection();
  toast(val ? 'Режим редактирования надписей включен. Выделяйте территории.' : 'Режим редактирования надписей выключен', 'info');
}

/* ═══════════════════════════════════════════════════════════════
   ПРИВЯЗКА ОСНОВНОГО UI
   ═══════════════════════════════════════════════════════════════ */

function initUIBindings() {
  document.querySelectorAll('input[name="edit-mode"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      if (labelEditMode) {
        toast('Выключите режим редактирования надписей', 'error');
        syncFsMode(mode);
        return;
      }
      setMode(e.target.value);
    });
  });

  on('btn-logout', 'click', async () => {
    if (await customConfirm('Выйти? Несохранённые изменения будут потеряны.')) logout();
  });

  initToolbar();
  initFiltersUI();
  initSelectionControls();
  initLabelControls();
  initAllianceControls();
  initLayoutControls();

  updateModeUI();
  updateSlidersFromSelection();
}

function initToolbar() {
  setupLabelsToggle('btn-toggle-labels');
  setupUnassignedIconsToggle('btn-toggle-icons');

  on('btn-download', 'click', () => openModal('modal-download'));
  on('modal-download', 'click', (e) => {
    const btn = e.target.closest('[data-download]');
    if (!btn) return;
    const [theme, kind] = btn.dataset.download.split('-');
    closeModal('modal-download');
    exportMapPNG(kind === 'labels', theme);
  });
  on('btn-close-download', 'click', () => closeModal('modal-download'));

  const showHiddenCb = document.getElementById('chk-show-hidden');
  if (showHiddenCb) {
    showHiddenCb.checked = isHiddenLabelsVisible();
    showHiddenCb.addEventListener('change', (e) => {
      toggleHiddenLabelsExternal();
      toast(e.target.checked ? 'Показан скрытый текст' : 'Скрытый текст выключен', 'info');
    });
  }
}

function initFiltersUI() {
  const redraw = () => { renderFilterControls('filters-container', filters, highlightFiltered); highlightFiltered(); };
  renderFilterControls('filters-container', filters, highlightFiltered);

  on('btn-filters-all', 'click', () => { setAllFilters(filters, true); redraw(); });
  on('btn-filters-none', 'click', () => { setAllFilters(filters, false); redraw(); });
}

function initSelectionControls() {
  const adjCb = document.getElementById('chk-adjacency');
  if (adjCb) {
    adjCb.addEventListener('change', (e) => {
      setAdjacencyMode(e.target.checked);
      toast(adjacencyMode ? 'Режим: только соседние территории' : 'Режим: любые территории', 'info');
    });
  }

  const chkLimits = document.getElementById('chk-respect-limits');
  if (chkLimits) {
    chkLimits.addEventListener('change', (e) => {
      respectLimits = e.target.checked;
      syncLimitUI();
      saveWorkingToSession();
    });
  }

  const limitHandlers = { 'limit-cities': 'cities', 'limit-bastions': 'bastions', 'limit-trade': 'trade' };
  Object.entries(limitHandlers).forEach(([id, key]) => {
    on(id, 'input', (e) => applyLimitInput(key, e.target.value));
  });

  on('alliance-select', 'change', (e) => {
    setSelectedAlliance(e.target.value || null);
    if (mode === MODES.territoryToAlliance && selectedAllianceId) applyAllianceToSelected(true);
  });
  on('btn-apply-alliance', 'click', () => applyAllianceToSelected(false));

  on('btn-select-all', 'click', () => toast(`Выбрано: ${selectAllFiltered(territoryPassesFilter)}`, 'success'));
  on('btn-clear-selection', 'click', () => { clearSelection(); toast('Выбор сброшен', 'success'); });
  on('btn-clear-selected', 'click', clearSelectedAssignments);
  on('btn-clear-all', 'click', clearAllAssignments);
  on('btn-clear-filtered', 'click', clearFilteredAssignments);
}

function applyLimitInput(key, value) {
  const parsed = parseLimitInput(value);
  if (key === 'cities') limitCities = parsed;
  else if (key === 'bastions') limitBastions = parsed;
  else limitTradePosts = parsed;
  syncLimitUI();
  saveWorkingToSession();
}

function initLabelControls() {
  on('chk-edit-labels-mode', 'change', (e) => setLabelEditMode(e.target.checked));

  on('chk-drag-drop', 'change', (e) => {
    if (!enableDragDrop(e.target.checked)) { e.target.checked = false; return; }
    toast(e.target.checked
      ? 'Перетаскивание включено. Зажмите выделенную территорию для движения.'
      : 'Перетаскивание выключено', 'info');
  });

  on('chk-multi-select', 'change', (e) => { isMultiSelect = e.target.checked; });

  on('btn-label-select-all', 'click', () => {
    if (!labelEditMode) return toast('Включите режим надписей', 'error');
    toast(`Выбрано: ${selectAllFiltered(territoryPassesFilter)}`, 'success');
    updateSlidersFromSelection();
  });
  on('btn-label-clear-selection', 'click', () => {
    clearSelection();
    toast('Выбор сброшен', 'success');
    updateSlidersFromSelection();
  });

  const sliders = { 'lbl-dx': 'dx', 'lbl-dy': 'dy', 'lbl-rot': 'rotation', 'lbl-scale': 'scale' };
  Object.entries(sliders).forEach(([id, key]) => {
    on(id, 'input', (e) => patchLabels((cfg) => ({ ...cfg, [key]: parseFloat(e.target.value) })));
  });

  on('btn-reset-labels', 'click', async () => {
    const ids = getSelected();
    if (!ids.length) return toast('Выберите территории', 'error');
    if (!await customConfirm('Сбросить размещение подписей у выбранных территорий?')) return;
    await saveLabelSettings(resetLabelCfg(getLabelSettings(), ids), false);
    updateSlidersFromSelection();
    toast('Сброшено', 'success');
  });
}

/** Меняет настройки подписей выбранных территорий (общий mutator). */
function patchLabels(mutator) {
  const patched = patchSelectedLabels(mutator);
  if (!patched) return toast('Сначала выберите территории', 'error');
  setLabelSettings(patched.settings);
  return null;
}

function initAllianceControls() {
  on('btn-add-alliance', 'click', () => {
    openModal('modal-alliance');
    document.getElementById('al-tag').value = '';
    document.getElementById('al-name').value = '';
    document.getElementById('al-color').value = pickUniqueColor(workingAlliances.map((a) => a.color));
  });
  on('btn-close-alliance', 'click', () => closeModal('modal-alliance'));
  on('btn-save-alliance', 'click', saveNewAlliance);

  on('btn-shuffle-colors', 'click', shuffleColors);

  on('btn-save-edit-alliance', 'click', saveEditAlliance);
  on('btn-close-edit-alliance', 'click', () => {
    closeModal('modal-edit-alliance');
    editingAllianceId = null;
  });
}

function initLayoutControls() {
  on('btn-save-layout', 'click', () => {
    openModal('modal-save');
    document.getElementById('save-name').value = nowString();
    document.getElementById('save-desc').value = '';
  });
  on('btn-close-save', 'click', () => closeModal('modal-save'));
  on('btn-do-save', 'click', doSaveLayout);

  on('btn-cancel', 'click', async () => {
    if (await customConfirm('Несохранённые изменения будут потеряны. Выйти?')) {
      sessionStorage.removeItem(sessionKey());
      window.location.href = 'index.html';
    }
  });

  on('btn-approve', 'click', async () => {
    if (session.isMainManager) {
      if (await customConfirm('Утвердить? Станет видимым для всех.')) doApprove();
      return;
    }
    openModal('modal-submit');
    document.getElementById('submit-name').value = nowString();
    document.getElementById('submit-desc').value = '';
  });
  on('btn-close-submit', 'click', () => closeModal('modal-submit'));
  on('btn-do-submit', 'click', doSubmitForApproval);

  on('btn-load-layouts', 'click', showLayoutsModal);
  on('btn-close-layouts', 'click', () => closeModal('modal-layouts'));
}

/* ═══════════════════════════════════════════════════════════════
   ОЧИСТКА НАЗНАЧЕНИЙ (общие для обеих панелей)
   ═══════════════════════════════════════════════════════════════ */

function clearSelectedAssignments() {
  const sel = getSelected();
  if (!sel.length) return toast('Ничего не выбрано', 'error');
  sel.forEach((id) => delete workingAssignments[id]);
  clearSelection();
  afterAssignmentsChanged('Очищено выбранное');
}

async function clearAllAssignments() {
  if (!await customConfirm('Очистить все назначения?')) return;
  workingAssignments = {};
  clearSelection();
  afterAssignmentsChanged('Очищено всё');
}

async function clearFilteredAssignments() {
  if (!await customConfirm('Очистить территории по фильтрам?')) return;
  const ids = getFilteredTerritories(filters);
  ids.forEach((id) => delete workingAssignments[id]);
  afterAssignmentsChanged(`Очищено ${ids.length}`);
}

function afterAssignmentsChanged(message) {
  applyWorking();
  saveWorkingToSession();
  renderAlliancesList();
  toast(message, 'success');
}

function shuffleColors() {
  if (!workingAlliances.length) return toast('Нет союзов', 'error');
  shuffleAllianceColors(workingAlliances);
  saveWorkingToSession();
  renderAll();
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   ОТРИСОВКА СПИСКОВ
   ═══════════════════════════════════════════════════════════════ */

function renderAll() {
  applyWorking();
  renderAlliancesList();
  renderAllianceSelect(workingAlliances, selectedAllianceId);
  highlightFiltered();
}

function renderAlliancesList() {
  renderAlliancesRanking('alliances-ranking', workingAlliances, {
    stats: computeAllianceStats(workingAssignments),
    incomes: computeAllianceIncomes(workingAssignments),
    layout: 'card',
    emptyText: 'Нет союзов. Нажмите «Добавить союз».',
    onMoveRank: moveRank,
    onEdit: editAlliance,
    onDelete: deleteAlliance,
  });
}

function moveRank(id, dir) {
  const idx = workingAlliances.findIndex((a) => a.id === id);
  const newIdx = idx + dir;
  if (idx < 0 || newIdx < 0 || newIdx >= workingAlliances.length) return;
  [workingAlliances[idx], workingAlliances[newIdx]] = [workingAlliances[newIdx], workingAlliances[idx]];
  renumberRanks(workingAlliances);
  saveWorkingToSession();
  renderAlliancesList();
  renderAllianceSelect(workingAlliances, selectedAllianceId);
}

/* ═══════════════════════════════════════════════════════════════
   СОЮЗЫ: создание / правка / удаление
   ═══════════════════════════════════════════════════════════════ */

function saveNewAlliance() {
  const checked = validateTag(document.getElementById('al-tag').value, workingAlliances);
  if (!checked.ok) return toast(checked.error, 'error');

  let color = document.getElementById('al-color').value;
  if (!color || color === '#000000') color = pickUniqueColor(workingAlliances.map((a) => a.color));

  workingAlliances.push({
    id: createAllianceId(),
    tag: checked.tag,
    name: document.getElementById('al-name').value.trim(),
    color,
    rank: workingAlliances.length + 1,
  });
  saveWorkingToSession();
  closeModal('modal-alliance');
  renderAll();
  toast('Союз добавлен', 'success');
}

function editAlliance(id) {
  const a = workingAlliances.find((x) => x.id === id);
  if (!a) return;
  editingAllianceId = id;
  document.getElementById('edit-al-tag').value = a.tag || '';
  document.getElementById('edit-al-name').value = a.name || '';
  document.getElementById('edit-al-color').value = a.color || '#3b82f6';
  openModal('modal-edit-alliance');
}

function saveEditAlliance() {
  const a = workingAlliances.find((x) => x.id === editingAllianceId);
  if (!a) return;

  const checked = validateTag(document.getElementById('edit-al-tag').value, workingAlliances, editingAllianceId);
  if (!checked.ok) return toast(checked.error, 'error');

  a.tag = checked.tag;
  a.name = document.getElementById('edit-al-name').value.trim();
  a.color = document.getElementById('edit-al-color').value;
  saveWorkingToSession();
  closeModal('modal-edit-alliance');
  editingAllianceId = null;
  renderAll();
  toast('Союз обновлён', 'success');
}

async function deleteAlliance(id) {
  if (!await customConfirm('Удалить союз?')) return;
  workingAlliances = workingAlliances.filter((a) => a.id !== id);
  renumberRanks(workingAlliances);
  Object.keys(workingAssignments).forEach((k) => { if (workingAssignments[k] === id) delete workingAssignments[k]; });
  if (selectedAllianceId === id) selectedAllianceId = null;
  saveWorkingToSession();
  renderAll();
}

/* ═══════════════════════════════════════════════════════════════
   ПОЛНОЭКРАННАЯ ПАНЕЛЬ — единая реализация из fs-panel.js
   ═══════════════════════════════════════════════════════════════ */

function initFsPanel() {
  createFsPanel({
    containerId: 'map-container',
    features: { limits: true, dragDrop: true },
    isVisible: () => ({ labels: isLabelsVisible(), icons: isUnassignedIconsVisible() }),

    onSetMode: (m) => {
      if (labelEditMode) {
        toast('Выключите режим редактирования надписей', 'error');
        syncFsMode(mode);
        return;
      }
      setMode(m);
    },
    onSetAlliance: (id) => {
      setSelectedAlliance(id);
      if (mode === MODES.territoryToAlliance && id) applyAllianceToSelected(true);
    },
    onApplyAlliance: () => applyAllianceToSelected(false),
    onSetAdjacency: (val) => setAdjacencyMode(val),
    onSetRespectLimits: (val) => { respectLimits = val; syncLimitUI(); saveWorkingToSession(); },
    onLimitInput: applyLimitInput,
    onSelectAll: () => selectAllFiltered(territoryPassesFilter),
    onClearSelection: () => clearSelection(),
    onClearSelected: clearSelectedAssignments,
    onClearAll: clearAllAssignments,
    onClearFiltered: clearFilteredAssignments,
    onShuffleColors: () => shuffleColors(),
    onSetEditLabels: (val) => setLabelEditMode(val),
    onSetDragDrop: (val) => enableDragDrop(val),
    onPatchLabels: (mutator) => { patchLabels(mutator); },
    onResetLabels: async (ids) => { await saveLabelSettings(resetLabelCfg(getLabelSettings(), ids), false); },
    onSaveLabels: async () => { await saveLabelSettings(getLabelSettings()); },
    onSyncSliders: () => updateSlidersFromSelection(),
  });

  // Панель создаётся скрытой — переносим в неё текущий режим и лимиты
  syncFsMode(mode);
  syncLimitUI();

  // map-core дергает этот хук при клике по кнопкам тулбара, чтобы FS-панель
  // перекрасила свои переключатели «Подписи»/«Иконки» в актуальное состояние.
  window.updateFsVisualToggles = () =>
    document.getElementById('fullscreen-edit-panel')?.refreshVisualToggles?.();
}

/* ═══════════════════════════════════════════════════════════════
   РАСКЛАДКИ: сохранение, утверждение, загрузка
   ═══════════════════════════════════════════════════════════════ */

async function updateLayoutOrCreate(updateData, fallbackFullData) {
  if (savedLayoutId) {
    try {
      await updateDoc(doc(db, 'layouts', savedLayoutId), updateData);
      return savedLayoutId;
    } catch (e) {
      const isNotFound = e.code === 'not-found' || /No document to update/i.test(e.message || '');
      if (!isNotFound) throw e;
      savedLayoutId = null;
    }
  }
  const ref = await addDoc(collection(db, 'layouts'), fallbackFullData);
  savedLayoutId = ref.id;
  return savedLayoutId;
}

function layoutPayload(name, description, status) {
  return {
    name, description,
    authorId: session.keyId, authorName: session.name,
    date: serverTimestamp(),
    status,
    data: { alliances: workingAlliances, assignments: workingAssignments },
  };
}

async function doSaveLayout() {
  const name = document.getElementById('save-name').value.trim() || nowString();
  const description = document.getElementById('save-desc').value.trim();
  try {
    const data = layoutPayload(name, description, 'draft');
    await updateLayoutOrCreate(data, data);
    saveWorkingToSession();
    closeModal('modal-save');
    toast('Сохранено', 'success');
  } catch (e) { console.error(e); toast('Ошибка сохранения: ' + e.message, 'error'); }
}

async function doSubmitForApproval() {
  const name = document.getElementById('submit-name').value.trim() || nowString();
  const description = document.getElementById('submit-desc').value.trim();
  try {
    const data = layoutPayload(name, description, 'pending');
    await updateLayoutOrCreate(data, data);
    saveWorkingToSession();
    closeModal('modal-submit');
    toast('Отправлено', 'success');
  } catch (e) { console.error(e); toast('Ошибка: ' + e.message, 'error'); }
}

async function doApprove() {
  try {
    const oldTt = await getDocs(collection(db, 'territories'));
    for (const d of oldTt.docs) await deleteDoc(doc(db, 'territories', d.id));
    for (const [tid, aid] of Object.entries(workingAssignments)) {
      await setDoc(doc(db, 'territories', tid), { allianceId: aid });
    }

    const oldAl = await getDocs(collection(db, 'alliances'));
    for (const d of oldAl.docs) await deleteDoc(doc(db, 'alliances', d.id));
    for (let i = 0; i < workingAlliances.length; i++) {
      const a = workingAlliances[i];
      await setDoc(doc(db, 'alliances', a.id), { tag: a.tag, name: a.name || '', color: a.color, rank: i + 1 });
    }

    await updateLayoutOrCreate(
      { status: 'approved', approvedAt: serverTimestamp() },
      layoutPayload(nowString(), '', 'approved'),
    );
    await setMeta({ approvedLayoutId: savedLayoutId });
    sessionStorage.removeItem(sessionKey());
    toast('Утверждено!', 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 1000);
  } catch (e) { toast('Ошибка утверждения: ' + e.message, 'error'); }
}

async function showLayoutsModal() {
  const list = document.getElementById('layouts-list');
  openModal('modal-layouts');
  list.innerHTML = '<p class="text-center py-4 text-gray-500">Загрузка...</p>';
  try {
    const snap = await getDocs(collection(db, 'layouts'));
    const all = []; snap.forEach((d) => all.push({ id: d.id, ...d.data() }));
    const layouts = all.filter((l) => l.authorId === session.keyId || (session.isMainManager && l.status === 'pending'));
    layouts.sort((a, b) => (b.date?.toDate?.() || 0) - (a.date?.toDate?.() || 0));

    if (!layouts.length) {
      list.innerHTML = '<p class="text-center py-4 text-gray-500">Нет сохранённых раскладок</p>';
      return;
    }

    list.innerHTML = layouts.map((l) => {
      const st = LAYOUT_STATUS[l.status] || LAYOUT_STATUS.draft;
      const isOwn = l.authorId === session.keyId;
      const canApprove = session.isMainManager && l.status === 'pending' && !isOwn;
      return `
        <div class="border dark:border-gray-700 rounded p-3 mb-2 bg-white dark:bg-gray-800">
          <div class="flex justify-between items-start mb-1">
            <div><span class="font-semibold">${escapeHtml(l.name)}</span><span class="text-xs ${st.className} text-white px-1.5 py-0.5 rounded ml-2">${st.label}</span></div>
            ${isOwn ? `<button class="del-layout text-red-500" data-id="${l.id}"><i class="fas fa-trash"></i></button>` : ''}
          </div>
          <div class="text-xs text-gray-500 mb-2">${escapeHtml(l.authorName)} · ${formatDate(l.date)}</div>
          ${l.description ? `<p class="text-sm mb-2">${escapeHtml(l.description)}</p>` : ''}
          <div class="flex flex-wrap gap-2">
            <button class="load-layout bg-blue-600 text-white text-sm px-3 py-1 rounded" data-id="${l.id}" data-merge="1">Загрузить (сохранить)</button>
            <button class="load-layout bg-orange-600 text-white text-sm px-3 py-1 rounded" data-id="${l.id}" data-merge="0">Загрузить (заменить)</button>
            ${canApprove ? `<button class="approve-layout bg-green-600 text-white text-sm px-3 py-1 rounded" data-id="${l.id}">Утвердить</button><button class="reject-layout bg-red-600 text-white text-sm px-3 py-1 rounded" data-id="${l.id}">Отклонить</button>` : ''}
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.load-layout').forEach((b) => b.addEventListener('click', () => loadLayout(b.dataset.id, b.dataset.merge === '1')));
    list.querySelectorAll('.del-layout').forEach((b) => b.addEventListener('click', () => delLayout(b.dataset.id)));
    list.querySelectorAll('.approve-layout').forEach((b) => b.addEventListener('click', () => approveLayout(b.dataset.id)));
    list.querySelectorAll('.reject-layout').forEach((b) => b.addEventListener('click', () => rejectLayout(b.dataset.id)));
  } catch (e) { list.innerHTML = `<p class="text-red-500">Ошибка: ${escapeHtml(e.message)}</p>`; }
}

async function loadLayout(id, merge) {
  try {
    const snap = await getDoc(doc(db, 'layouts', id));
    if (!snap.exists()) return toast('Не найдено', 'error');
    const l = snap.data();
    workingAlliances = l.data.alliances;
    workingAssignments = merge ? { ...workingAssignments, ...l.data.assignments } : { ...l.data.assignments };
    savedLayoutId = id;
    saveWorkingToSession();
    renderAll();
    closeModal('modal-layouts');
    toast('Загружено', 'success');
  } catch (e) { toast('Ошибка загрузки: ' + e.message, 'error'); }
}

async function delLayout(id) {
  if (!await customConfirm('Удалить?')) return;
  try {
    await deleteDoc(doc(db, 'layouts', id));
    if (savedLayoutId === id) { savedLayoutId = null; saveWorkingToSession(); }
    await showLayoutsModal();
  } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
}

async function approveLayout(id) {
  try {
    const snap = await getDoc(doc(db, 'layouts', id));
    if (!snap.exists()) return;
    const l = snap.data();
    if (!await customConfirm(`Утвердить «${l.name}» от ${l.authorName}?`)) return;
    workingAlliances = l.data.alliances;
    workingAssignments = l.data.assignments;
    savedLayoutId = id;
    await doApprove();
  } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
}

async function rejectLayout(id) {
  if (!await customConfirm('Отклонить?')) return;
  try {
    await updateDoc(doc(db, 'layouts', id), { status: 'rejected' });
    await showLayoutsModal();
    toast('Отклонено', 'success');
  } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
}
