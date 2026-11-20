// Единая полноэкранная панель инструментов для администратора и управляющего.
// Заменяет ~200 строк дублирующегося HTML и обработчиков в admin.js и manager.js.

import { getSelected } from './map-core.js';
import { toast, customConfirm, setControlsEnabled } from './utils.js';
import { paintFsToolButton } from './common-ui.js';
import { FS_TOOL_BTN, ICONS } from './constants.js';

// ═══════════════════════════════════════════════════════════════
// HTML-шаблон панели
// ═══════════════════════════════════════════════════════════════

function panelHtml({ limits = false, dragDrop = false } = {}) {
  const dragDropRow = dragDrop ? `
            <label class="flex items-center text-[10px] cursor-pointer text-blue-600 dark:text-blue-400 font-semibold mt-1">
              <input type="checkbox" id="fs-chk-drag-drop" class="mr-1">
              Перетаскивание (D&amp;D)
            </label>` : '';

  const limitsBlock = limits ? `
        <!-- ─── Лимиты ─── -->
        <div class="pt-2 border-t dark:border-gray-700">
          <div class="font-semibold mb-1 text-xs">Лимиты:</div>
          <div class="grid grid-cols-3 gap-1">
            <div>
              <label class="block text-[10px] text-gray-500">Города</label>
              <input type="number" id="fs-limit-cities" value="6" min="0" class="w-full border rounded p-1 dark:bg-gray-700 dark:border-gray-600 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-gray-500">Бастионы</label>
              <input type="number" id="fs-limit-bastions" value="6" min="0" class="w-full border rounded p-1 dark:bg-gray-700 dark:border-gray-600 text-xs">
            </div>
            <div>
              <label class="block text-[10px] text-gray-500">Торг.</label>
              <input type="text" id="fs-limit-trade" value="∞" class="w-full border rounded p-1 dark:bg-gray-700 dark:border-gray-600 text-xs">
            </div>
          </div>
        </div>` : '';

  const respectLimitsRow = limits ? `
        <label class="flex items-center text-xs cursor-pointer">
          <input type="checkbox" id="fs-chk-respect-limits" class="mr-2">
          Учитывать лимиты территорий
        </label>` : '';

  const clearFilteredRow = limits ? `
          <button id="fs-btn-clear-filtered" class="w-full px-2 py-1 bg-orange-600 text-white rounded text-xs hover:bg-orange-700">Очистить по фильтрам</button>` : '';

  return `
    <div id="fullscreen-edit-panel" class="hidden absolute top-0 right-0 h-full w-[320px] bg-white/95 dark:bg-gray-800/95 backdrop-blur shadow-2xl z-30 overflow-y-auto flex flex-col border-l border-gray-200 dark:border-gray-700">
      <div class="p-3 border-b dark:border-gray-700 flex justify-between items-center sticky top-0 bg-white/95 dark:bg-gray-800/95 z-10">
        <h3 class="font-bold text-sm"><i class="fas fa-tools mr-1 text-blue-500"></i>Инструменты</h3>
        <button id="btn-close-fullscreen-panel" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"><i class="fas fa-times"></i></button>
      </div>

      <div class="p-3 space-y-4 text-sm">
        <div class="grid grid-cols-2 gap-2 pb-2 border-b dark:border-gray-700">
          <button id="fs-btn-labels" class="${FS_TOOL_BTN.base} ${FS_TOOL_BTN.off}">${ICONS.eye}Подписи</button>
          <button id="fs-btn-icons" class="${FS_TOOL_BTN.base} ${FS_TOOL_BTN.off}">${ICONS.layers}Иконки</button>
        </div>

        <div>
          <div class="font-semibold mb-1">Режим:</div>
          <div class="space-y-1 text-xs">
            <label class="flex items-center"><input type="radio" name="fs-edit-mode" value="territory-to-alliance" checked class="mr-2">Территории → Союз</label>
            <label class="flex items-center"><input type="radio" name="fs-edit-mode" value="alliance-to-territory" class="mr-2">Союз → Территории</label>
          </div>
        </div>

        <div>
          <label class="block font-semibold mb-1">Активный союз:</label>
          <div class="flex gap-1">
            <select id="fs-alliance-select" class="flex-1 border rounded p-1.5 dark:bg-gray-700 dark:border-gray-600 text-xs"></select>
            <button id="fs-btn-apply-alliance" class="px-2 py-1.5 bg-blue-600 text-white rounded text-xs whitespace-nowrap hover:bg-blue-700"><i class="fas fa-check"></i></button>
          </div>
        </div>

        <label class="flex items-center text-xs cursor-pointer">
          <input type="checkbox" id="fs-chk-adjacency" class="mr-2">
          Только соседние территории
        </label>
${respectLimitsRow}

        <div id="fs-selection-controls" class="grid grid-cols-2 gap-1">
          <button id="fs-btn-select-all" class="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"><i class="fas fa-check-square mr-1"></i>Все</button>
          <button id="fs-btn-clear-selection" class="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700"><i class="fas fa-square mr-1"></i>Сброс</button>
        </div>

        <div class="space-y-1">
          <button id="fs-btn-clear-selected" class="w-full px-2 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700">Очистить выбранное</button>
          <button id="fs-btn-clear-all" class="w-full px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">Очистить всё</button>
${clearFilteredRow}
        </div>

        <div class="pt-2 border-t dark:border-gray-700 space-y-2">
          <div class="flex items-center justify-between">
            <div class="font-semibold text-xs text-purple-600 dark:text-purple-400"><i class="fas fa-font mr-1"></i>Размещение надписей</div>
            <label class="flex items-center text-[10px] cursor-pointer text-gray-600 dark:text-gray-400">
              <input type="checkbox" id="fs-chk-edit-labels" class="mr-1">
              Вкл
            </label>
          </div>${dragDropRow}
          <div id="fs-label-controls" class="space-y-2 opacity-50 pointer-events-none transition-opacity">
            <div class="grid grid-cols-2 gap-1">
              <button id="fs-btn-select-all-labels" class="px-1 py-1 bg-blue-600 text-white rounded text-[10px] hover:bg-blue-700">Выбрать все</button>
              <button id="fs-btn-clear-selection-labels" class="px-1 py-1 bg-gray-600 text-white rounded text-[10px] hover:bg-gray-700">Снять</button>
            </div>
            <div><label class="text-[10px]">Смещение X</label><input type="range" id="fs-lbl-dx" min="-50" max="50" step="1" value="0" class="w-full"></div>
            <div><label class="text-[10px]">Смещение Y</label><input type="range" id="fs-lbl-dy" min="-50" max="50" step="1" value="0" class="w-full"></div>
            <div><label class="text-[10px]">Поворот</label><input type="range" id="fs-lbl-rot" min="-180" max="180" step="5" value="0" class="w-full"></div>
            <div><label class="text-[10px]">Масштаб</label><input type="range" id="fs-lbl-scale" min="0.3" max="3" step="0.1" value="1" class="w-full"></div>
            <button id="fs-btn-reset-labels" class="w-full px-1 py-1 bg-orange-600 text-white rounded text-[10px] hover:bg-orange-700">Сбросить выбранные</button>
          </div>
        </div>

        <div class="pt-2 border-t dark:border-gray-700">
          <button id="fs-btn-shuffle-colors" class="w-full px-2 py-2 bg-pink-600 text-white rounded text-xs hover:bg-pink-700 font-semibold">
            <i class="fas fa-random mr-1"></i>Перемешать цвета
          </button>
        </div>

        <div class="pt-2 border-t dark:border-gray-700">
          <button id="fs-btn-save-labels" class="w-full px-2 py-2 bg-green-600 text-white rounded text-xs hover:bg-green-700 font-semibold">
            <i class="fas fa-save mr-1"></i>Применить подписи
          </button>
        </div>
${limitsBlock}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// СОЗДАНИЕ ПАНЕЛИ
// ═══════════════════════════════════════════════════════════════

/**
 * Создаёт полноэкранную панель и привязывает все её контролы.
 * Все коллбэки опциональны — панель просто не реагирует на отсутствующие.
 *
 * @param {Object} opts
 * @param {string|HTMLElement} opts.containerId  контейнер карты
 * @param {{limits?:boolean, dragDrop?:boolean}} [opts.features]
 * @param {Function} [opts.isVisible]            актуальное состояние тумблеров для перкраски кнопок
 * @returns {HTMLElement|null} саму панель
 */
export function createFsPanel(opts) {
  const {
    containerId,
    features = {},
    isVisible = () => ({}),
    onClose,
    onSetMode,
    onSetAlliance,
    onApplyAlliance,
    onSetAdjacency,
    onSetRespectLimits,
    onLimitInput,
    onSelectAll,
    onClearSelection,
    onClearSelected,
    onClearAll,
    onClearFiltered,
    onShuffleColors,
    onSetEditLabels,
    onSetDragDrop,
    onPatchLabels,
    onResetLabels,
    onSaveLabels,
    onSyncSliders,
  } = opts;

  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return null;
  const existing = document.getElementById('fullscreen-edit-panel');
  if (existing) return existing;

  container.insertAdjacentHTML('beforeend', panelHtml(features));
  const panel = document.getElementById('fullscreen-edit-panel');
  const byId = (id) => document.getElementById(id);
  const listen = (id, event, fn) => { const el = byId(id); if (el && fn) el.addEventListener(event, fn); };

  // ─── Закрытие: делегируем кнопке «Инструменты» на карте ───
  listen('btn-close-fullscreen-panel', 'click', () => {
    const toolsBtn = document.querySelector('.map-controls [data-action="toggleFullscreenEdit"]');
    if (toolsBtn) toolsBtn.click();
    else onClose?.();
  });

  // ─── Режим редактирования ───
  panel.querySelectorAll('input[name="fs-edit-mode"]').forEach((r) => {
    r.addEventListener('change', (e) => onSetMode?.(e.target.value));
  });

  // ─── Соседство / лимиты ───
  listen('fs-chk-adjacency', 'change', (e) => onSetAdjacency?.(e.target.checked));
  listen('fs-chk-respect-limits', 'change', (e) => onSetRespectLimits?.(e.target.checked));
  listen('fs-limit-cities', 'input', (e) => onLimitInput?.('cities', e.target.value));
  listen('fs-limit-bastions', 'input', (e) => onLimitInput?.('bastions', e.target.value));
  listen('fs-limit-trade', 'input', (e) => onLimitInput?.('trade', e.target.value));

  // ─── Союз ───
  listen('fs-alliance-select', 'change', (e) => onSetAlliance?.(e.target.value || null));
  listen('fs-btn-apply-alliance', 'click', () => onApplyAlliance?.());

  // ─── Выбор территорий ───
  listen('fs-btn-select-all', 'click', () => {
    const count = onSelectAll?.();
    if (typeof count === 'number') toast(`Выбрано: ${count}`, 'success');
  });
  listen('fs-btn-clear-selection', 'click', () => { onClearSelection?.(); toast('Выбор сброшен', 'success'); });
  listen('fs-btn-clear-selected', 'click', () => onClearSelected?.());
  listen('fs-btn-clear-all', 'click', () => onClearAll?.());
  listen('fs-btn-clear-filtered', 'click', () => onClearFiltered?.());

  // ─── Визуальные тумблеры ───
  const fsBtnLabels = byId('fs-btn-labels');
  const fsBtnIcons = byId('fs-btn-icons');

  const refreshVisualToggles = () => {
    const state = isVisible() || {};
    paintFsToolButton(fsBtnLabels, !!state.labels, FS_TOOL_BTN.labelsOn);
    paintFsToolButton(fsBtnIcons, !!state.icons, FS_TOOL_BTN.iconsOn);
  };
  refreshVisualToggles();
  panel.refreshVisualToggles = refreshVisualToggles;

  // Клик по FS-кнопке эмулирует кнопку основной панели: состояние и localStorage
  // обновляются в одном месте (map-core), расхождение двух панелей невозможно.
  listen('fs-btn-labels', 'click', () => { byId('btn-toggle-labels')?.click(); refreshVisualToggles(); });
  listen('fs-btn-icons', 'click', () => { byId('btn-toggle-icons')?.click(); refreshVisualToggles(); });

  // ─── Режим надписей ───
  // fs-панель только читает событие и зовёт коллбэк; синхронизацию с основной
  // панелью, подсветку блоков и тосты делает страница (admin/manager).
  const fsChkEditLabels = byId('fs-chk-edit-labels');
  listen('fs-chk-edit-labels', 'change', (e) => onSetEditLabels?.(e.target.checked));

  // ─── Перетаскивание ───
  const fsChkDD = byId('fs-chk-drag-drop');
  if (fsChkDD) {
    fsChkDD.addEventListener('change', (e) => {
      const wanted = e.target.checked;
      const applied = onSetDragDrop?.(wanted);
      // Коллбэк вернул false — режим надписей выключен, откатываем галку
      if (wanted && applied === false) e.target.checked = false;
    });
  }

  // ─── Слайдеры ───
  const patchFromSlider = (key) => (e) => {
    if (!getSelected().length) { toast('Сначала выберите территории', 'error'); return; }
    const value = parseFloat(e.target.value);
    onPatchLabels?.((cfg) => ({ ...cfg, [key]: value }));
    onSyncSliders?.();
  };
  listen('fs-lbl-dx', 'input', patchFromSlider('dx'));
  listen('fs-lbl-dy', 'input', patchFromSlider('dy'));
  listen('fs-lbl-rot', 'input', patchFromSlider('rotation'));
  listen('fs-lbl-scale', 'input', patchFromSlider('scale'));

  // ─── Сброс подписей ───
  listen('fs-btn-reset-labels', 'click', async () => {
    const ids = getSelected();
    if (!ids.length) return toast('Выберите территории', 'error');
    if (!await customConfirm('Сбросить подписи у выбранных?')) return;
    await onResetLabels?.(ids);
    onSyncSliders?.();
    toast('Сброшено', 'success');
  });

  // ─── Выбор в режиме надписей ───
  listen('fs-btn-select-all-labels', 'click', () => {
    if (!fsChkEditLabels?.checked) return toast('Включите режим надписей', 'error');
    const count = onSelectAll?.();
    if (typeof count === 'number') toast(`Выбрано: ${count}`, 'success');
    onSyncSliders?.();
  });
  listen('fs-btn-clear-selection-labels', 'click', () => {
    onClearSelection?.();
    toast('Выбор сброшен', 'success');
    onSyncSliders?.();
  });

  // ─── Применить подписи ───
  listen('fs-btn-save-labels', 'click', async () => {
    await onSaveLabels?.();
    toast('Подписи применены и сохранены', 'success');
  });

  // ─── Перемешать цвета ───
  // Тост об успехе показывает страница — у неё есть свои сообщения об ошибках
  // («Нет союзов»), иначе пользователь получил бы противоречивую пару тостов.
  listen('fs-btn-shuffle-colors', 'click', async () => {
    if (!await customConfirm('Перемешать цвета всех союзов?')) return;
    await onShuffleColors?.();
  });

  // ─── Синхронизация с текущим состоянием ───
  setControlsEnabled(byId('fs-label-controls'), !!fsChkEditLabels?.checked);
  onSyncSliders?.();

  return panel;
}

/** Показывает/скрывает панель (колбэк map-core onFullscreenEditToggle). */
export function setFsPanelVisible(active, { onShown } = {}) {
  const panel = document.getElementById('fullscreen-edit-panel');
  if (!panel) return;
  panel.classList.toggle('hidden', !active);
  if (active) {
    panel.refreshVisualToggles?.();
    onShown?.();
  }
}

/** Заполняет поля лимитов в FS-панели (значения Infinity → «∞»). */
export function syncFsLimits({ cities, bastions, trade, respect }) {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val === Infinity ? '∞' : val;
  };
  setVal('fs-limit-cities', cities);
  setVal('fs-limit-bastions', bastions);
  setVal('fs-limit-trade', trade);
  const chk = document.getElementById('fs-chk-respect-limits');
  if (chk) chk.checked = !!respect;
}

/** Отмечает радиокнопки режима в обеих панелях. */
export function syncFsMode(mode) {
  document.querySelectorAll('input[name="edit-mode"], input[name="fs-edit-mode"]').forEach((r) => {
    r.checked = r.value === mode;
  });
}

/** Синхронизирует чекбокс соседства в обеих панелях. */
export function syncFsAdjacency(value) {
  ['chk-adjacency', 'fs-chk-adjacency'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
  });
}
