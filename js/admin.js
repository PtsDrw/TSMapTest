import { db } from './firebase-config.js';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  initTheme, generateKey, toast, customConfirm, customPrompt,
  openModal, closeModal, on, escapeHtml, createAllianceId, validateTag,
  renumberRanks, setControlsEnabled,
} from './utils.js';
import {
  initMap, exportMapPNG, getLabelSettings, saveLabelSettings,
  selectTerritory, getSelected, clearSelection, selectAllFiltered, getAllTerritoryIds,
  setLabelSettings, setPreviewData, setupLabelsToggle, setupUnassignedIconsToggle,
  computeAllianceStats, computeAllianceIncomes,
  isLabelsVisible, isUnassignedIconsVisible,
  isHiddenLabelsVisible, toggleHiddenLabelsExternal,
  setLabelEditMode as setLabelEditModeCore, setDragMode,
  setMapEditMode, isMapEditMode,
  loadResourceNames, saveResourceNames,
} from './map-core.js';
import { requireAuth, logout } from './auth.js';
import { pickUniqueColor } from './palette.js';
import {
  renderAlliancesRanking, renderAllianceSelect, syncLabelSliders,
  patchSelectedLabels, resetLabelCfg, shuffleAllianceColors, paintToolButton,
} from './common-ui.js';
import { createFsPanel, setFsPanelVisible, syncFsMode, syncFsAdjacency } from './fs-panel.js';
import { DEFAULT_LABEL_CFG, ICONS, MODES, ARCADIA_ID } from './constants.js';

let currentKeyId = null;
let workingAlliances = [];
let workingAssignments = {};
let selectedAllianceId = null;
let mode = MODES.territoryToAlliance;
let hasUnsavedChanges = false;
let labelEditMode = false;
let isMultiSelect = true;

/* ═══════════════════════════════════════════════════════════════
   ИНИЦИАЛИЗАЦИЯ
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth(['admin'])) return;
  initTheme();

  on('btn-logout', 'click', logout);

  const map = await initMap({
    containerId: 'map-container',
    interactive: true,
    clickHandler: onTerritoryClick,
    onFullscreenEditToggle: (active) => setFsPanelVisible(active, { onShown: updateSlidersFromSelection }),
  });

  if (!map) {
    toast('Карта не загружена — проверьте assets/map.svg', 'error');
  } else {
    initFsPanel();
  }

  try {
    await loadMapData();
  } catch (e) {
    console.error('[admin] loadMapData failed:', e);
    toast('Ошибка данных: ' + e.message, 'error');
  }

  try { await renderKeysList(); } catch (e) { console.error('[admin] renderKeysList:', e); }
  renderAll();

  initKeyModal();
  initAllianceModal();
  initMapDataControls();
  initLabelControls();
  initToolbar();
  try { await initResourceSettings(); } catch (e) { console.error('[admin] initResourceSettings:', e); }

  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
  });
});

async function loadMapData() {
  const al = await getDocs(collection(db, 'alliances'));
  workingAlliances = [];
  al.forEach((d) => workingAlliances.push({ id: d.id, ...d.data() }));
  workingAlliances.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  const tt = await getDocs(collection(db, 'territories'));
  workingAssignments = {};
  tt.forEach((d) => { workingAssignments[d.id] = d.data().allianceId; });

  applyWorking();
}

function applyWorking() {
  setPreviewData(
    Object.fromEntries(workingAlliances.map((a) => [a.id, a])),
    workingAssignments
  );
}

function renderAll() {
  renderAlliances();
  renderAllianceSelect(workingAlliances, selectedAllianceId);
}

/* ═══════════════════════════════════════════════════════════════
   КЛИК ПО ТЕРРИТОРИИ
   ═══════════════════════════════════════════════════════════════ */

function onTerritoryClick(id, el) {
  if (id === ARCADIA_ID) return;

  if (labelEditMode) {
    const isSel = el.classList.contains('selected');
    if (!isMultiSelect) clearSelection();
    selectTerritory(id, !isSel);
    updateSlidersFromSelection();
    return;
  }

  if (mode === MODES.territoryToAlliance) {
    selectTerritory(id, !el.classList.contains('selected'));
    updateSlidersFromSelection();
  } else {
    if (!selectedAllianceId) { toast('Сначала выберите союз', 'error'); return; }
    if (workingAssignments[id] === selectedAllianceId) delete workingAssignments[id];
    else workingAssignments[id] = selectedAllianceId;
    hasUnsavedChanges = true;
    applyWorking();
    renderAlliances();
  }
}

function applyAllianceToSelected(silent = false) {
  if (!selectedAllianceId) {
    if (!silent) toast('Выберите союз из списка', 'error');
    return;
  }
  const sel = getSelected();
  if (!sel.length) {
    if (!silent) toast('Сначала выберите территории на карте', 'error');
    return;
  }
  const alliance = workingAlliances.find((a) => a.id === selectedAllianceId);
  if (!alliance) { if (!silent) toast('Союз не найден', 'error'); return; }

  sel.forEach((id) => { workingAssignments[id] = selectedAllianceId; });
  clearSelection();
  hasUnsavedChanges = true;
  applyWorking();
  renderAlliances();
  toast(`Назначено: ${sel.length} → ${alliance.tag}`, 'success');
}

function setEditMode(newMode) {
  if (labelEditMode) return toast('Выключите режим надписей', 'error');
  mode = newMode;
  syncFsMode(newMode);
  clearSelection();
  return true;
}

/* ═══════════════════════════════════════════════════════════════
   СОХРАНЕНИЕ КАРТЫ
   ═══════════════════════════════════════════════════════════════ */

async function saveMapData() {
  toast('Сохранение...', 'info');
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

    hasUnsavedChanges = false;
    toast('Карта сохранена', 'success');
  } catch (e) {
    console.error(e);
    toast('Ошибка сохранения: ' + e.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════
   КЛЮЧИ ДОСТУПА
   ═══════════════════════════════════════════════════════════════ */

async function renderKeysList() {
  const list = document.getElementById('keys-list');
  if (!list) return;
  const snap = await getDocs(collection(db, 'access_keys'));
  const keys = [];
  snap.forEach((d) => keys.push({ id: d.id, ...d.data() }));
  keys.sort((a, b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0));

  if (!keys.length) {
    list.innerHTML = '<p class="text-center text-gray-500 py-3 text-xs">Нет ключей</p>';
    return;
  }

  list.innerHTML = keys.map((k, i) => `
    <div class="flex items-center gap-1.5 py-1.5 border-b dark:border-gray-700 text-xs">
      <span class="text-gray-400 w-4 text-center">${i + 1}.</span>
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate flex items-center gap-1">
          ${escapeHtml(k.name)}
          ${k.isMainManager ? '<span class="text-purple-500" title="Главный">★</span>' : ''}
          ${k.isRevoked ? '<span class="text-red-500 text-[10px]">(отозван)</span>' : ''}
        </div>
        <div class="font-mono text-gray-500 truncate text-[11px]">${escapeHtml(k.key)}</div>
      </div>
      <button class="copy-key text-blue-500 hover:text-blue-700 px-0.5" data-key="${escapeHtml(k.key)}" title="Копировать"><i class="fas fa-copy"></i></button>
      <button class="toggle-key text-${k.isRevoked ? 'green' : 'yellow'}-500 hover:opacity-80 px-0.5" data-id="${k.id}" data-revoked="${k.isRevoked}" title="${k.isRevoked ? 'Восстановить' : 'Отозвать'}">
        <i class="fas fa-${k.isRevoked ? 'check-circle' : 'ban'}"></i>
      </button>
      <button class="delete-key text-red-500 hover:text-red-700 px-0.5" data-id="${k.id}" title="Удалить"><i class="fas fa-trash"></i></button>
    </div>
  `).join('');

  list.querySelectorAll('.copy-key').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.key);
      toast('Ключ скопирован', 'success');
    } catch { toast('Не удалось скопировать', 'error'); }
  }));

  list.querySelectorAll('.toggle-key').forEach((b) => b.addEventListener('click', async () => {
    await updateDoc(doc(db, 'access_keys', b.dataset.id), { isRevoked: b.dataset.revoked !== 'true' });
    await renderKeysList();
  }));

  list.querySelectorAll('.delete-key').forEach((b) => b.addEventListener('click', async () => {
    if (await customConfirm('Удалить ключ?')) {
      await deleteDoc(doc(db, 'access_keys', b.dataset.id));
      await renderKeysList();
    }
  }));
}

function initKeyModal() {
  const gen = document.getElementById('key-gen');
  const nameInput = document.getElementById('key-name');
  const mainCheck = document.getElementById('key-main');

  on('btn-create-key', 'click', (e) => {
    e.stopPropagation();
    currentKeyId = null;
    gen.value = generateKey();
    nameInput.value = '';
    mainCheck.checked = false;
    openModal('modal-key');
  });
  on('btn-regen-key', 'click', () => { gen.value = generateKey(); });
  on('btn-close-key', 'click', () => closeModal('modal-key'));

  on('btn-save-key', 'click', async () => {
    const name = nameInput.value.trim();
    if (!name) return toast('Введите имя', 'error');
    try {
      if (currentKeyId) {
        await updateDoc(doc(db, 'access_keys', currentKeyId), {
          name, isMainManager: mainCheck.checked, key: gen.value,
        });
      } else {
        await setDoc(doc(db, 'access_keys', Date.now().toString()), {
          key: gen.value,
          name,
          isMainManager: mainCheck.checked,
          isRevoked: false,
          createdAt: serverTimestamp(),
        });
      }
      closeModal('modal-key');
      toast('Сохранено', 'success');
      await renderKeysList();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ═══════════════════════════════════════════════════════════════
   РЕСУРСЫ
   ═══════════════════════════════════════════════════════════════ */

async function initResourceSettings() {
  const res = await loadResourceNames();
  const cityInput = document.getElementById('res-city-name');
  const bastionInput = document.getElementById('res-bastion-name');
  if (cityInput) cityInput.value = res.city === 'Медь' ? '' : res.city;
  if (bastionInput) bastionInput.value = res.bastion === 'Кварц' ? '' : res.bastion;

  on('btn-save-resources', 'click', async () => {
    const city = cityInput?.value.trim() || 'Медь';
    const bastion = bastionInput?.value.trim() || 'Кварц';
    await saveResourceNames({ city, bastion });
    toast('Названия ресурсов сохранены', 'success');
  });
}

/* ═══════════════════════════════════════════════════════════════
   СОЮЗЫ
   ═══════════════════════════════════════════════════════════════ */

function renderAlliances() {
  renderAlliancesRanking('alliances-ranking', workingAlliances, {
    layout: 'row',
    emptyText: 'Нет союзов. Нажмите «+».',
    stats: computeAllianceStats(workingAssignments),
    incomes: computeAllianceIncomes(workingAssignments),
    onMoveRank: moveRank,
    onEdit: editAlliance,
    onDelete: deleteAlliance,
  });
}

function moveRank(id, dir) {
  const idx = workingAlliances.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= workingAlliances.length) return;
  [workingAlliances[idx], workingAlliances[newIdx]] = [workingAlliances[newIdx], workingAlliances[idx]];
  renumberRanks(workingAlliances);
  hasUnsavedChanges = true;
  renderAll();
}

function initAllianceModal() {
  on('btn-add-alliance', 'click', (e) => {
    e.stopPropagation();
    openModal('modal-alliance');
    const tag = document.getElementById('al-tag');
    const name = document.getElementById('al-name');
    if (tag) tag.value = '';
    if (name) name.value = '';
    const color = document.getElementById('al-color');
    if (color) color.value = pickUniqueColor(workingAlliances.map((a) => a.color));
  });
  on('btn-close-alliance', 'click', () => closeModal('modal-alliance'));
  on('btn-save-alliance', 'click', saveNewAlliance);
}

function saveNewAlliance() {
  const rawTag = document.getElementById('al-tag').value.trim().toUpperCase();
  const name = document.getElementById('al-name').value.trim();
  let color = document.getElementById('al-color').value;

  const check = validateTag(rawTag, workingAlliances);
  if (!check.ok) return toast(check.error, 'error');

  if (!color || color === '#000000') color = pickUniqueColor(workingAlliances.map((a) => a.color));

  workingAlliances.push({
    id: createAllianceId(),
    tag: check.tag,
    name,
    color,
    rank: workingAlliances.length + 1,
  });
  hasUnsavedChanges = true;
  closeModal('modal-alliance');
  renderAll();
  toast('Союз добавлен. Не забудьте «Сохранить карту»', 'success');
}

async function editAlliance(id) {
  const a = workingAlliances.find((x) => x.id === id);
  if (!a) return;

  const tagAnswer = await customPrompt('Новый тег (3 символа):', a.tag);
  if (tagAnswer === null) return;
  const check = validateTag(tagAnswer, workingAlliances, id);
  if (!check.ok) return toast(check.error, 'error');

  const nameAnswer = await customPrompt('Название:', a.name || '');
  a.tag = check.tag;
  a.name = nameAnswer ?? a.name;
  hasUnsavedChanges = true;
  renderAll();
}

async function deleteAlliance(id) {
  if (!await customConfirm('Удалить союз? Все его территории освободятся.')) return;
  workingAlliances = workingAlliances.filter((a) => a.id !== id);
  renumberRanks(workingAlliances);
  Object.keys(workingAssignments).forEach((k) => {
    if (workingAssignments[k] === id) delete workingAssignments[k];
  });
  if (selectedAllianceId === id) selectedAllianceId = null;
  hasUnsavedChanges = true;
  applyWorking();
  renderAll();
}

function shuffleColors() {
  if (!workingAlliances.length) return toast('Нет союзов', 'error');
  shuffleAllianceColors(workingAlliances);
  hasUnsavedChanges = true;
  applyWorking();
  renderAll();
  toast('Цвета переназначены', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   УПРАВЛЕНИЕ КАРТОЙ (основная панель)
   ═══════════════════════════════════════════════════════════════ */

function initMapDataControls() {
  document.querySelectorAll('input[name="edit-mode"]').forEach((r) => {
    r.addEventListener('change', (e) => setEditMode(e.target.value));
  });

  on('alliance-select', 'change', (e) => {
    selectedAllianceId = e.target.value || null;
    if (mode === MODES.territoryToAlliance && selectedAllianceId) applyAllianceToSelected(true);
  });
  on('btn-apply-alliance', 'click', () => applyAllianceToSelected(false));

  on('btn-select-all', 'click', () => {
    toast(`Выбрано: ${selectAllFiltered()}`, 'success');
    updateSlidersFromSelection();
  });
  on('btn-clear-selection', 'click', () => {
    clearSelection();
    toast('Выбор сброшен', 'success');
  });

  on('btn-clear-territories', 'click', async () => {
    if (!await customConfirm('Очистить ВСЕ назначения территорий?')) return;
    workingAssignments = {};
    clearSelection();
    hasUnsavedChanges = true;
    applyWorking();
    renderAlliances();
    toast('Назначения очищены', 'success');
  });

  on('btn-save-map', 'click', saveMapData);
  on('btn-shuffle-colors', 'click', async () => {
    if (!await customConfirm('Переназначить случайные цвета всем союзам?')) return;
    shuffleColors();
  });
}

/* ═══════════════════════════════════════════════════════════════
   ПОДПИСИ (основная панель)
   ═══════════════════════════════════════════════════════════════ */

function initLabelControls() {
  const applyToSelected = (mutator) => {
    const patched = patchSelectedLabels(mutator);
    if (!patched) return toast('Сначала выберите территории', 'error');
    setLabelSettings(patched.settings);
  };

  const sliders = [
    { id: 'lbl-dx', key: 'dx' },
    { id: 'lbl-dy', key: 'dy' },
    { id: 'lbl-rot', key: 'rotation' },
    { id: 'lbl-scale', key: 'scale' },
  ];
  sliders.forEach(({ id, key }) => {
    on(id, 'input', (e) => applyToSelected((c) => ({ ...c, [key]: parseFloat(e.target.value) })));
  });

  on('lbl-global-scale', 'input', (e) => {
    const value = parseFloat(e.target.value);
    const settings = getLabelSettings();
    getAllTerritoryIds().forEach((id) => {
      settings[id] = { ...(settings[id] || DEFAULT_LABEL_CFG), scale: value };
    });
    setLabelSettings(settings);
  });

  on('btn-reset-selected', 'click', async () => {
    const ids = getSelected();
    if (!ids.length) return toast('Выберите территории', 'error');
    const updates = resetLabelCfg({}, ids);
    await saveLabelSettings(updates, true);
    updateSlidersFromSelection();
    toast('Сброшено у выбранных', 'success');
  });

  on('btn-reset-all', 'click', async () => {
    if (!await customConfirm('Сбросить все настройки подписей?')) return;
    const all = resetLabelCfg({}, getAllTerritoryIds());
    await saveLabelSettings(all, true);
    updateSlidersFromSelection();
    toast('Сброшено у всех', 'success');
  });

  on('btn-save-labels', 'click', async () => {
    await saveLabelSettings(getLabelSettings());
    toast('Настройки подписей сохранены', 'success');
  });

  on('chk-edit-labels-mode', 'change', (e) => setLabelEditMode(e.target.checked));

  on('chk-drag-drop', 'change', (e) => {
    if (!enableDragDrop(e.target.checked)) {
      e.target.checked = false;
      return;
    }
    toast(e.target.checked ? 'Перетаскивание включено. Зажмите выделенную территорию.' : 'Перетаскивание выключено', 'info');
  });

  // ⭐ Исправлено: раньше обработчик был пустым, чекбокс не действовал
  on('chk-multi-select', 'change', (e) => { isMultiSelect = e.target.checked; });

  on('btn-label-select-all', 'click', () => {
    if (!labelEditMode) return toast('Включите режим надписей', 'error');
    toast(`Выбрано: ${selectAllFiltered()}`, 'success');
    updateSlidersFromSelection();
  });
  on('btn-label-clear-selection', 'click', () => {
    clearSelection();
    toast('Выбор сброшен', 'success');
    updateSlidersFromSelection();
  });
}

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

/** Единая точка синхронизации слайдеров обеих панелей. */
function updateSlidersFromSelection() {
  syncLabelSliders({ panelId: 'label-selection-controls' });
}
window.updateSlidersFromSelection = updateSlidersFromSelection;

/** Переключает режим подписей из любого источника (главная или FS-панель). */
function setLabelEditMode(val) {
  labelEditMode = val;
  setLabelEditModeCore(val);

  ['chk-edit-labels-mode', 'fs-chk-edit-labels'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = val;
  });
  setControlsEnabled(document.getElementById('label-selection-controls'), val);
  setControlsEnabled(document.getElementById('fs-label-controls'), val);

  if (!val) enableDragDrop(false);
  clearSelection();
  updateSlidersFromSelection();
  toast(val ? 'Режим надписей включен. Выделяйте территории.' : 'Режим надписей выключен', 'info');
}

/* ═══════════════════════════════════════════════════════════════
   ТУЛБАР
   ═══════════════════════════════════════════════════════════════ */

function initToolbar() {
  setupLabelsToggle('btn-toggle-labels');
  setupUnassignedIconsToggle('btn-toggle-icons');

  const btnHidden = document.getElementById('btn-toggle-hidden');
  const updateBtnHidden = () => {
    if (!btnHidden) return;
    const active = isHiddenLabelsVisible();
    paintToolButton(btnHidden, active, { kind: 'hidden' });
    btnHidden.innerHTML = (active ? ICONS.eye : ICONS.eyeSlash) + 'Скрытый текст' + (active ? ' вкл' : '');
  };

  if (btnHidden) {
    btnHidden.addEventListener('click', () => {
      toggleHiddenLabelsExternal();
      updateBtnHidden();
    });
    updateBtnHidden();
  }

  on('btn-download', 'click', () => openModal('modal-download'));
  on('modal-download', 'click', (e) => {
    const btn = e.target.closest('[data-download]');
    if (!btn) return;
    const [theme, kind] = btn.dataset.download.split('-');
    closeModal('modal-download');
    exportMapPNG(kind === 'labels', theme);
  });
  on('btn-close-download', 'click', () => closeModal('modal-download'));
}

/* ═══════════════════════════════════════════════════════════════
   ПОЛНОЭКРАННАЯ ПАНЕЛЬ — единая реализация из fs-panel.js
   ═══════════════════════════════════════════════════════════════ */

function initFsPanel() {
  createFsPanel({
    containerId: 'map-container',
    features: { dragDrop: true, limits: false },
    isVisible: () => ({ labels: isLabelsVisible(), icons: isUnassignedIconsVisible() }),
    isEditMode: () => isMapEditMode(),
    onSetEditMode: (val) => {
      setMapEditMode(val);
      if (!val) clearSelection();
      return true;
    },

    onSetMode: (m) => {
      if (labelEditMode) {
        toast('Выключите режим надписей', 'error');
        syncFsMode(mode);
        return;
      }
      mode = m;
      syncFsMode(m);
      clearSelection();
    },
    onSetAlliance: (id) => {
      selectedAllianceId = id;
      const main = document.getElementById('alliance-select');
      if (main) main.value = id || '';
      if (mode === MODES.territoryToAlliance && id) applyAllianceToSelected(true);
    },
    onApplyAlliance: () => applyAllianceToSelected(false),
    onSetAdjacency: (val) => syncFsAdjacency(val),
    onSelectAll: () => selectAllFiltered(),
    onClearSelection: () => clearSelection(),
    onClearSelected: () => {
      const sel = getSelected();
      if (!sel.length) return toast('Ничего не выбрано', 'error');
      sel.forEach((id) => delete workingAssignments[id]);
      clearSelection();
      hasUnsavedChanges = true;
      applyWorking();
      renderAlliances();
      toast('Очищено выбранное', 'success');
    },
    onClearAll: async () => {
      if (!await customConfirm('Очистить все назначения?')) return;
      workingAssignments = {};
      clearSelection();
      hasUnsavedChanges = true;
      applyWorking();
      renderAlliances();
      toast('Очищено всё', 'success');
    },
    onShuffleColors: async () => {
      if (!workingAlliances.length) return toast('Нет союзов', 'error');
      shuffleColors();
    },
    onSetEditLabels: (val) => setLabelEditMode(val),
    onSetDragDrop: (val) => enableDragDrop(val),
    onPatchLabels: (mutator) => {
      const patched = patchSelectedLabels(mutator);
      if (patched) setLabelSettings(patched.settings);
    },
    onResetLabels: async (ids) => {
      await saveLabelSettings(resetLabelCfg(getLabelSettings(), ids));
    },
    onSaveLabels: async () => { await saveLabelSettings(getLabelSettings()); },
    onSyncSliders: () => updateSlidersFromSelection(),
  });

  // Панель создаётся скрытой — синхронизируем текущий режим
  syncFsMode(mode);

  // map-core дергает этот хук при клике по кнопкам тулбара, чтобы FS-панель
  // перекрасила свои переключатели «Подписи»/«Иконки» в актуальное состояние.
  window.updateFsVisualToggles = () =>
    document.getElementById('fullscreen-edit-panel')?.refreshVisualToggles?.();
}
