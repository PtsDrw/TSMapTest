// Единая полноэкранная панель инструментов для администратора и управляющего.
// Заменяет ~200 строк дублирующегося HTML и обработчиков в admin.js и manager.js.

import { getSelected, nudgeLabelByScreen, commitLabelSettings, isMapFullscreen, setLabelSelectionHook } from './map-core.js';
import { toast, customConfirm, setControlsEnabled } from './utils.js';
import { paintFsToolButton } from './common-ui.js';
import { FS_TOOL_BTN, ICONS } from './constants.js';

// ═══════════════════════════════════════════════════════════════
// HTML-шаблон панели
// ═══════════════════════════════════════════════════════════════

function panelHtml({ limits = false } = {}) {
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
        <label id="fs-edit-mode-toggle-label" class="flex items-center justify-between gap-2 p-2 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-xs font-bold cursor-pointer text-blue-700 dark:text-blue-300">
          <span><i class="fas fa-pen mr-1"></i><span id="fs-edit-mode-toggle-text">Включить редактирование</span></span>
          <input type="checkbox" id="fs-chk-map-edit" class="w-4 h-4 flex-shrink-0">
        </label>

        <div id="fs-tools-disabled-note" class="text-[10px] text-gray-500 dark:text-gray-400 leading-tight -mt-2">
          Пока редактирование выключено, инструменты неактивны: тап по территории показывает информацию.
        </div>

        <div class="grid grid-cols-2 gap-2 pb-2 border-b dark:border-gray-700">
          <button id="fs-btn-labels" class="${FS_TOOL_BTN.base} ${FS_TOOL_BTN.off}">${ICONS.eye}Подписи</button>
          <button id="fs-btn-icons" class="${FS_TOOL_BTN.base} ${FS_TOOL_BTN.off}">${ICONS.layers}Иконки</button>
        </div>

        <div id="fs-tools-body" class="space-y-4 opacity-50 pointer-events-none transition-opacity">

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

        <div class="pt-2 border-t dark:border-gray-700">
          <button id="fs-btn-shuffle-colors" class="w-full px-2 py-2 bg-pink-600 text-white rounded text-xs hover:bg-pink-700 font-semibold">
            <i class="fas fa-random mr-1"></i>Перемешать цвета
          </button>
        </div>
${limitsBlock}
        </div>

        <!-- Сюда встаёт блок «Размещение надписей» на десктопе. Он живёт вне
             fs-tools-body: у блока собственный переключатель, поэтому общее
             «редактирование карты выключено» не должно гасить ползунки. -->
        <div id="fs-labels-slot"></div>
      </div>
    </div>`;
}
/**
 * Блок «Размещение надписей». Живёт отдельно от panelHtml: на телефоне он
 * переезжает в нижнюю панель, на десктопе — в основную панель инструментов.
 * Ползунки гасит только собственный переключатель «Вкл», а не общий режим
 * редактирования карты.
 */
function labelsSectionHtml(dragDrop = false) {
  const dragDropRow = dragDrop ? `
            <label class="flex items-center text-[10px] cursor-pointer text-blue-600 dark:text-blue-400 font-semibold mt-1">
              <input type="checkbox" id="fs-chk-drag-drop" class="mr-1">
              Перетаскивание (D&amp;D)
            </label>` : '';

  return `
    <div id="fs-labels-section" class="pt-2 border-t dark:border-gray-700 space-y-2">
      <div class="flex items-center justify-between">
        <div class="font-semibold text-xs text-purple-600 dark:text-purple-400"><i class="fas fa-font mr-1"></i>Размещение надписей</div>
        <div class="flex items-center gap-2">
          <label class="flex items-center text-[10px] cursor-pointer text-gray-600 dark:text-gray-400">
            <input type="checkbox" id="fs-chk-edit-labels" class="mr-1">
            Вкл
          </label>
          <button id="fs-close-labels-sheet" type="button" class="hidden text-gray-500 hover:text-gray-700 dark:hover:text-gray-300" title="Закрыть размещение надписей" aria-label="Закрыть размещение надписей"><i class="fas fa-times"></i></button>
        </div>
      </div>${dragDropRow}
      <div id="fs-label-controls" class="space-y-2 opacity-50 pointer-events-none transition-opacity">
        <div class="grid grid-cols-2 gap-1">
          <button id="fs-btn-select-all-labels" class="px-1 py-1 bg-blue-600 text-white rounded text-[10px] hover:bg-blue-700">Выбрать все</button>
          <button id="fs-btn-clear-selection-labels" class="px-1 py-1 bg-gray-600 text-white rounded text-[10px] hover:bg-gray-700">Снять</button>
        </div>
        <div id="fs-label-sliders" class="space-y-2">
          <div><label class="text-[10px]">Смещение X</label><input type="range" id="fs-lbl-dx" min="-50" max="50" step="1" value="0" class="w-full"></div>
          <div><label class="text-[10px]">Смещение Y</label><input type="range" id="fs-lbl-dy" min="-50" max="50" step="1" value="0" class="w-full"></div>
          <div><label class="text-[10px]">Поворот</label><input type="range" id="fs-lbl-rot" min="-180" max="180" step="5" value="0" class="w-full"></div>
          <div><label class="text-[10px]">Масштаб</label><input type="range" id="fs-lbl-scale" min="0.3" max="3" step="0.1" value="1" class="w-full"></div>
          <button id="fs-btn-reset-labels" class="w-full px-1 py-1 bg-orange-600 text-white rounded text-[10px] hover:bg-orange-700">Сбросить выбранные</button>
        </div>
        <div id="fs-touchpad-wrap" class="hidden">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[10px] font-semibold text-purple-600 dark:text-purple-400">Тачпад подписи</span>
            <span id="fs-touchpad-offset" class="text-[10px] text-gray-500 dark:text-gray-400 font-mono">0 / 0</span>
          </div>
          <div id="fs-touchpad" class="fs-touchpad">
            <i class="fas fa-up-down-left-right fs-touchpad-icon"></i>
          </div>
          <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-tight mt-1">
            Ведите пальцем по площадке — подпись выбранной территории смещается от текущего значения.
          </p>
        </div>
      </div>
      <!-- Вне гасимого блока: сохранить подписи можно и при выключенном режиме -->
      <button id="fs-btn-save-labels" class="w-full px-2 py-2 bg-green-600 text-white rounded text-xs hover:bg-green-700 font-semibold">
        <i class="fas fa-save mr-1"></i>Применить подписи
      </button>
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
    onSetHiddenLabels,
    onSetDragDrop,
    onPatchLabels,
    onResetLabels,
    onSaveLabels,
    onSyncSliders,
    isEditMode = () => false,
    onSetEditMode,
    isLabelEditMode = () => false,
  } = opts;

  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return null;
  const existing = document.getElementById('fullscreen-edit-panel');
  if (existing) return existing;

  container.insertAdjacentHTML('beforeend', panelHtml(features));
  const panel = document.getElementById('fullscreen-edit-panel');
  // Нижняя панель для телефона: сюда переезжает блок «Размещение надписей».
  // Держим её отдельным элементом контейнера — панель имеет backdrop-blur,
  // а он создаёт containing block и ломает position: fixed внутри себя.
  let sheet = document.getElementById('fs-labels-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'fs-labels-sheet';
    sheet.className = 'fs-labels-sheet hidden';
    container.appendChild(sheet);
  }
  // Блок надписей создаётся один раз; место вставки выбирает layoutLabelsSection.
  const labelsHolder = document.createElement('div');
  labelsHolder.innerHTML = labelsSectionHtml(features.dragDrop);
  const labelsSection = labelsHolder.firstElementChild;
  const labelsSlot = panel.querySelector('#fs-labels-slot');
  (labelsSlot || panel).appendChild(labelsSection);

  const byId = (id) => document.getElementById(id);
  const listen = (id, event, fn) => { const el = byId(id); if (el && fn) el.addEventListener(event, fn); };

  // ─── Закрытие: делегируем кнопке «Инструменты» на карте ───
  listen('btn-close-fullscreen-panel', 'click', () => {
    const toolsBtn = document.querySelector('.map-controls [data-action="toggleFullscreenEdit"]');
    if (toolsBtn) toolsBtn.click();
    else onClose?.();
  });

  // ─── Режим редактирования (главный переключатель, важен для мобильных) ───
  const fsChkMapEdit = byId('fs-chk-map-edit');
  const fsEditToggleText = byId('fs-edit-mode-toggle-text');
  const fsToolsBody = byId('fs-tools-body');
  const fsToolsNote = byId('fs-tools-disabled-note');

  const refreshEditMode = () => {
    const active = !!isEditMode();
    if (fsChkMapEdit) fsChkMapEdit.checked = active;
    if (fsEditToggleText) fsEditToggleText.textContent = active ? 'Редактирование включено' : 'Включить редактирование';
    setControlsEnabled(fsToolsBody, active);
    if (fsToolsNote) fsToolsNote.style.display = active ? 'none' : '';
  };
  panel.refreshEditMode = refreshEditMode;

  listen('fs-chk-map-edit', 'change', (e) => {
    const wanted = e.target.checked;
    const applied = onSetEditMode?.(wanted);
    // Коллбэк вернул false — режим переключить нельзя (например, идёт сохранение)
    if (applied === false) e.target.checked = !wanted;
    refreshEditMode();
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
  const closeSheetBtn = byId('fs-close-labels-sheet');

  // Желаемое состояние правой панели: переключается кнопкой «Инструменты».
  // На телефоне в режиме надписей панель прячется, но флаг сохраняется,
  // чтобы после закрытия нижней панели вернуть её обратно.
  let panelWanted = !panel.classList.contains('hidden');
  // Тачпад/ползунки определяются ниже — здесь только ссылка
  let applyTouchpadState = () => {};
  // Раскладка «как на телефоне» определяется шириной экрана, а не наличием
  // тач-событий: так нижняя панель появляется и на реальном телефоне,
  // и в мобильной эмуляции DevTools. Пересчитываем на каждый вызов —
  // пользователь может повернуть телефон или изменить размер окна.
  const isPhoneLayout = () => window.matchMedia('(max-width: 1024px)').matches;

  /**
   * На телефоне в полноэкранном режиме блок «Размещение надписей» уезжает
   * в нижнюю панель (ближе к пальцам), на десктопе остаётся в панели справа.
   */
  const layoutLabelsSection = () => {
    // Нижняя панель — узкий экран + полноэкранный режим карты + включённый
    // режим надписей. Вне fullscreen переезда быть не должно: панель
    // инструментов существует только там.
    const asSheet = isPhoneLayout() && isMapFullscreen() && !!fsChkEditLabels?.checked;
    if (asSheet) {
      if (labelsSection.parentElement !== sheet) sheet.appendChild(labelsSection);
      sheet.classList.remove('hidden');
      panel.classList.add('hidden');
      closeSheetBtn?.classList.remove('hidden');
    } else {
      if (labelsSection.parentElement !== labelsSlot) labelsSlot.appendChild(labelsSection);
      sheet.classList.add('hidden');
      // Панель показываем только в полноэкранном режиме и только если её
      // открывали кнопкой «Инструменты» — вне fullscreen её быть не должно.
      panel.classList.toggle('hidden', !(panelWanted && isMapFullscreen()));
      closeSheetBtn?.classList.add('hidden');
    }
    applyTouchpadState();
  };
  panel.layoutLabelsSection = layoutLabelsSection;
  panel.setPanelWanted = (val) => { panelWanted = !!val; };
  // Вход/выход из fullscreen и поворот телефона меняют раскладку блока
  ['fullscreenchange', 'webkitfullscreenchange', 'map-fullscreenchange', 'resize', 'orientationchange']
    .forEach((evt) => window.addEventListener(evt, () => {
      panel.layoutLabelsSection?.();
      applyTouchpadState();
    }));
  /** Синхронизирует блок надписей с режимом, включённым из основной панели. */
  panel.refreshLabelsMode = (val) => {
    if (fsChkEditLabels) fsChkEditLabels.checked = !!val;
    setControlsEnabled(byId('fs-label-controls'), !!val);
    // Режим надписей включён — панель должна быть «открыта», чтобы блок
    // уехал в нижнюю панель, даже если правая панель инструментов закрыта.
    if (val) panelWanted = true;
    layoutLabelsSection();
  };

  listen('fs-chk-edit-labels', 'change', (e) => {
    const on = e.target.checked;
    onSetEditLabels?.(on);
    // Ползунки гасит только этот переключатель, а не общий режим редактирования
    setControlsEnabled(byId('fs-label-controls'), on);
    // Как и в основной панели управляющего: включение режима надписей
    // автоматически показывает скрытый текст, иначе часть подписей не видна.
    if (on) onSetHiddenLabels?.(true);
    layoutLabelsSection();
  });

  // Крестик закрывает нижнюю панель: режим надписей выключается,
  // блок возвращается на своё место в панели инструментов.
  const closeLabelsSheet = () => {
    if (fsChkEditLabels?.checked) {
      fsChkEditLabels.checked = false;
      onSetEditLabels?.(false);
      setControlsEnabled(byId('fs-label-controls'), false);
    }
    layoutLabelsSection();
  };
  panel.closeLabelsSheet = closeLabelsSheet;
  if (closeSheetBtn) closeSheetBtn.addEventListener('click', closeLabelsSheet);

  // ─── Перетаскивание ───
  const fsChkDD = byId('fs-chk-drag-drop');
  const touchpadWrap = byId('fs-touchpad-wrap');
  const slidersWrap = byId('fs-label-sliders');
  const touchpadOffset = byId('fs-touchpad-offset');

  /**
   * Показывает тачпад вместо ползунков при включённом D&D. Только телефон
   * в полноэкранном режиме: там панель внизу и подпись двигают по площадке,
   * не перекрывая текст пальцем. В остальных случаях остаются ползунки.
   */
  applyTouchpadState = () => {
    const ddOn = !!fsChkDD?.checked;
    // Тачпад — только на узком экране в полноэкранном режиме
    const usePad = isPhoneLayout() && ddOn && isMapFullscreen();
    if (touchpadWrap) touchpadWrap.classList.toggle('hidden', !usePad);
    if (slidersWrap) slidersWrap.classList.toggle('hidden', usePad);
    if (usePad && touchpadOffset) touchpadOffset.textContent = '0 / 0';
  };
  panel.applyTouchpadState = applyTouchpadState;

  if (fsChkDD) {
    fsChkDD.addEventListener('change', (e) => {
      const wanted = e.target.checked;
      const applied = onSetDragDrop?.(wanted);
      // Коллбэк вернул false — режим надписей выключен, откатываем галку
      if (wanted && applied === false) e.target.checked = false;
      applyTouchpadState();
    });
  }

  // ─── Тачпад подписи ───
  const touchpad = byId('fs-touchpad');
  if (touchpad) {
    let padIds = [], padActive = false, padX = 0, padY = 0, lastX = 0, lastY = 0, moved = false;

    // Подсказка о выбранной территории прямо на площадке
    const padHint = document.createElement('span');
    padHint.className = 'fs-touchpad-hint';
    touchpad.appendChild(padHint);
    const refreshPadHint = () => {
      const ids = getSelected();
      padHint.textContent = ids.length
        ? (ids.length === 1 ? ids[0] : `${ids.length} терр.`)
        : 'выберите территорию';
      touchpad.classList.toggle('is-empty', !ids.length);
    };
    panel.refreshTouchpadHint = refreshPadHint;
    refreshPadHint();
    // Выделение меняется тапом по карте — обновляем подсказку
    setLabelSelectionHook(refreshPadHint);

    const startPad = (e) => {
      const ids = getSelected();
      if (!ids.length) { toast('Сначала выберите территорию на карте', 'error'); return; }
      // Двигаем подписи всех выделенных территорий: переключение идёт тапом по карте
      padIds = ids;
      padActive = true;
      moved = false;
      padX = 0; padY = 0;
      const t = e.touches ? e.touches[0] : e;
      lastX = t.clientX; lastY = t.clientY;
      touchpad.classList.add('is-active');
      if (e.cancelable) e.preventDefault();
    };

    const movePad = (e) => {
      if (!padActive || !padIds.length) return;
      const t = e.touches ? e.touches[0] : e;
      const dx = t.clientX - lastX;
      const dy = t.clientY - lastY;
      lastX = t.clientX; lastY = t.clientY;
      if (!dx && !dy) return;
      moved = true;
      padX += dx; padY += dy;
      nudgeLabelByScreen(padIds, dx, dy);
      if (touchpadOffset) touchpadOffset.textContent = `${Math.round(padX)} / ${Math.round(padY)}`;
      if (e.cancelable) e.preventDefault();
    };

    const endPad = async () => {
      if (!padActive) return;
      padActive = false;
      touchpad.classList.remove('is-active');
      if (moved && padIds.length) await commitLabelSettings(padIds);
      padIds = [];
    };

    touchpad.addEventListener('mousedown', startPad);
    window.addEventListener('mousemove', movePad);
    window.addEventListener('mouseup', endPad);
    touchpad.addEventListener('touchstart', startPad, { passive: false });
    touchpad.addEventListener('touchmove', movePad, { passive: false });
    touchpad.addEventListener('touchend', endPad);
    touchpad.addEventListener('touchcancel', endPad);
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
  // Режим надписей мог быть включён ДО создания панели (кнопкой в основной
  // панели или после перезагрузки страницы). Тогда панель должна стартовать
  // с актуальным состоянием, иначе на телефоне не появится нижняя панель.
  const initialLabelMode = !!isLabelEditMode();
  if (fsChkEditLabels) fsChkEditLabels.checked = initialLabelMode;
  setControlsEnabled(byId('fs-label-controls'), initialLabelMode);
  if (initialLabelMode) panelWanted = true;
  refreshEditMode();
  layoutLabelsSection();
  onSyncSliders?.();

  return panel;
}

/** Показывает/скрывает панель (колбэк map-core onFullscreenEditToggle). */
export function setFsPanelVisible(active, { onShown } = {}) {
  const panel = document.getElementById('fullscreen-edit-panel');
  if (!panel) return;
  panel.setPanelWanted?.(active);
  if (active) {
    panel.refreshVisualToggles?.();
    panel.refreshEditMode?.();
    // На телефоне блок надписей должен оказаться в нижней панели, если режим уже включён
    panel.layoutLabelsSection?.();
    onShown?.();
  } else {
    panel.classList.add('hidden');
    // Панель закрыта — нижняя панель надписей тоже прячется. Режим надписей
    // не сбрасываем: он остаётся включённым и вернётся вместе с панелью.
    document.getElementById('fs-labels-sheet')?.classList.add('hidden');
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
