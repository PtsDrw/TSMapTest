import { db } from './firebase-config.js';
import { doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { toast } from './utils.js';
import {
  FALLBACK_VIEWBOX, LABELS_STATE_KEY, UNASSIGNED_ICONS_KEY,
  TRADE_STROKE_WIDTH, SVG_NS, TERRITORY_TYPES, LEVEL_BY_TYPE,
  ICON_SIZE, ICON_HALF, ICON_GAP, ICON_COLORS, ICON_TEXT_COLORS,
  LEGEND_ICON_POINTS, LABEL_OVERFLOW_STROKE, LABEL_TEMPLATE_STROKE,
  DEFAULT_RESOURCE_NAMES, EXPORT_THEMES,
  ARCADIA_ID, TEMPLATE_TAG,
} from './constants.js';

let panZoom = null;
let svgRoot = null;
let originalSvgText = '';
let originalSvgViewBox = null;
let labelSettings = {};
let allianceMap = {};
let territoryAssignments = {};
let selectedTerritories = new Set();
let showUnassignedIcons = false;
let showHiddenLabels = false;
let resourceNames = { ...DEFAULT_RESOURCE_NAMES };

let isDragMode = false;
let isDragging = false;
let dragTargetId = null;
let dragStartSettings = null;
let dragStartPoint = null;

// Перекраска состояния pan/zoom после смены режима (заполняется в addMapControls)
let refreshPanState = null;

/** Прерывает перетаскивание подписи, не сохраняя результат. */
function cancelLabelDrag() {
  isDragging = false;
  dragTargetId = null;
  dragStartSettings = null;
  dragStartPoint = null;
}

/**
 * Включает/выключает режим перетаскивания подписей.
 * Пока режим включён, панорамирование карты отключено — иначе при движении
 * подписи вместе с ней уезжает и карта.
 */
export function setDragMode(val) {
  isDragMode = !!val;
  if (!isDragMode) cancelLabelDrag();
  refreshPanState?.();
}

// Режим редактирования надписей живёт в модулях страниц; здесь только перерисовка.
export function setLabelEditMode() {
  buildLabelsLayer();
}

export async function loadResourceNames() {
  try {
    const snap = await getDoc(doc(db, 'meta', 'resources'));
    if (snap.exists()) {
      const data = snap.data();
      resourceNames.city = data.city || 'Медь';
      resourceNames.bastion = data.bastion || 'Кварц';
    }
  } catch (e) { console.warn('Error loading resources:', e); }
  return { ...resourceNames };
}

export async function saveResourceNames({ city, bastion }) {
  resourceNames.city = city || 'Медь';
  resourceNames.bastion = bastion || 'Кварц';
  await setDoc(doc(db, 'meta', 'resources'), resourceNames, { merge: true });
}

export function getResourceNames() { return { ...resourceNames }; }

export function getTerritoryIncome(id) {
  const type = getTerritoryType(id);
  const lvl = getTerritoryLevel(id);
  if (type === 'B' && lvl) return TERRITORY_TYPES.B.income[lvl] || 0;
  if (type === 'T') return 0;
  const lvlType = LEVEL_BY_TYPE[type];
  if (lvlType && TERRITORY_TYPES[type]) return TERRITORY_TYPES[type].income[lvlType] || 0;
  return 0;
}

export function computeAllianceIncomes(assignments) {
  const incomes = {};
  for (const [tid, aid] of Object.entries(assignments || {})) {
    if (!aid) continue;
    if (!incomes[aid]) incomes[aid] = { city: 0, bastion: 0 };
    const type = getTerritoryType(tid);
    const lvl = getTerritoryLevel(tid);
    if (type === 'B' && lvl) {
      incomes[aid].bastion += TERRITORY_TYPES.B.income[lvl] || 0;
    } else if (type !== 'T') {
      const lvlType = LEVEL_BY_TYPE[type];
      if (lvlType && TERRITORY_TYPES[type]) {
        incomes[aid].city += TERRITORY_TYPES[type].income[lvlType] || 0;
      }
    }
  }
  return incomes;
}

function createIconShape(kind, ns = SVG_NS) {
  const c = ICON_COLORS[kind] || ICON_COLORS.city;
  const points = kind === 'bastion'
    ? `${ICON_HALF},0 ${ICON_SIZE},0 ${ICON_SIZE},${ICON_HALF + 3} ${ICON_HALF},${ICON_SIZE} 0,${ICON_HALF + 3} 0,0`
    : kind === 'trade'
      ? `${ICON_HALF},0 ${ICON_SIZE},${ICON_HALF} ${ICON_HALF},${ICON_SIZE} 0,${ICON_HALF}`
      : `0,${ICON_HALF - 1} ${ICON_HALF},0 ${ICON_SIZE},${ICON_HALF - 1} ${ICON_SIZE},${ICON_SIZE} 0,${ICON_SIZE}`;

  const shape = document.createElementNS(ns, 'polygon');
  shape.setAttribute('points', points);
  shape.setAttribute('fill', c.fill);
  shape.setAttribute('stroke', c.stroke);
  shape.setAttribute('stroke-width', '0.6');
  shape.setAttribute('stroke-linejoin', 'round');
  return shape;
}

function getIconTextColor(kind) {
  return ICON_TEXT_COLORS[kind] || '#ffffff';
}

function createIconNumber(level, textColor = '#ffffff', ns = SVG_NS) {
  const t = document.createElementNS(ns, 'text');
  t.setAttribute('x', String(ICON_HALF));
  t.setAttribute('y', String(ICON_HALF + 0.5));
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'central');
  t.setAttribute('font-family', 'Arial, sans-serif');
  t.setAttribute('font-size', '6.5');
  t.setAttribute('font-weight', 'bold');
  t.setAttribute('fill', textColor);
  t.textContent = String(level);
  return t;
}

function getLabelStyleColors() {
  const isDark = document.documentElement.classList.contains('dark');
  return { fill: isDark ? '#ffffff' : '#000000', stroke: isDark ? '#000000' : '#ffffff' };
}

/**
 * Собирает SVG-группу подписи (иконка + клан-тег).
 * Используется и при живом рендере, и при экспорте PNG — чтобы стили не разъезжались.
 * @param {{ns:string, labelFill:string, labelStroke:string}} opts
 * @returns {Element|null} null, если рисовать нечего
 */
function buildLabelGroup(id, info, alliance, cfg, ox, oy, colors, opts = {}) {
  const ns = opts.ns || SVG_NS;
  const labelFill = opts.labelFill || colors.fill;
  const labelStroke = opts.labelStroke || colors.stroke;

  let tag = '';
  let showTag = false;
  let isOverflowing = false;
  let isTemplate = false;

  if (alliance) {
    tag = alliance.tag;
    const fits = doesTextFit(id, tag, ox, oy, cfg);
    // Показываем, если влезает ИЛИ включен «показать скрытый текст»
    showTag = fits || showHiddenLabels;
    isOverflowing = !fits && showHiddenLabels;
  } else if (showHiddenLabels) {
    tag = TEMPLATE_TAG;
    showTag = true;
    isTemplate = true;
    isOverflowing = !doesTextFit(id, tag, ox, oy, cfg);
  }

  // Иконку рисуем всегда (в т.ч. для showUnassignedIcons без текста)
  const tagWidth = showTag ? measureTextWidth(tag) : 0;
  const finalWidth = showTag ? (ICON_SIZE + ICON_GAP + tagWidth) : ICON_SIZE;
  const startX = -finalWidth / 2;

  const group = document.createElementNS(ns, 'g');
  group.setAttribute('transform', `translate(${ox + (cfg.dx || 0)} ${oy + (cfg.dy || 0)}) rotate(${cfg.rotation || 0}) scale(${cfg.scale || 1})`);

  const iconG = document.createElementNS(ns, 'g');
  iconG.setAttribute('transform', `translate(${startX} -${ICON_HALF})`);
  iconG.appendChild(createIconShape(info.kind, ns));
  iconG.appendChild(createIconNumber(info.level, getIconTextColor(info.kind), ns));
  group.appendChild(iconG);

  if (showTag) {
    const txt = document.createElementNS(ns, 'text');
    txt.setAttribute('x', String(startX + ICON_SIZE + ICON_GAP));
    txt.setAttribute('y', '0');
    txt.setAttribute('text-anchor', 'start');
    txt.setAttribute('dominant-baseline', 'central');
    txt.setAttribute('font-family', 'Arial, sans-serif');
    txt.setAttribute('font-size', '9');
    txt.setAttribute('font-weight', 'bold');
    txt.setAttribute('fill', cfg.fill || labelFill);

    if (isOverflowing) {
      txt.setAttribute('stroke', LABEL_OVERFLOW_STROKE);
      txt.setAttribute('stroke-width', '2');
    } else if (isTemplate) {
      txt.setAttribute('stroke', LABEL_TEMPLATE_STROKE);
      txt.setAttribute('stroke-width', '1.5');
      txt.setAttribute('stroke-dasharray', '2, 2');
    } else {
      txt.setAttribute('stroke', labelStroke);
      txt.setAttribute('stroke-width', '1');
    }

    txt.setAttribute('stroke-linejoin', 'round');
    txt.setAttribute('paint-order', 'stroke');
    txt.textContent = tag;
    group.appendChild(txt);
  }
  return group;
}

const textMeasureCanvas = document.createElement('canvas');
const textMeasureCtx = textMeasureCanvas.getContext('2d');

function measureTextWidth(text, fontSize = 9, fontWeight = 'bold') {
  textMeasureCtx.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
  return textMeasureCtx.measureText(text).width;
}

function parsePoints(str) {
  if (!str) return [];
  const arr = str.trim().split(/[\s,]+/).map(Number);
  const out = [];
  for (let i = 0; i + 1 < arr.length; i += 2) out.push([arr[i], arr[i + 1]]);
  return out;
}

function isPointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function doesTextFit(id, tag, ox, oy, cfg) {
  if (!tag) return false;
  const dx = cfg.dx || 0, dy = cfg.dy || 0;
  const rot = cfg.rotation || 0, scale = cfg.scale || 1;
  const tagWidth = measureTextWidth(tag);
  const totalWidthWithTag = ICON_SIZE + ICON_GAP + tagWidth;
  const totalHeight = Math.max(ICON_SIZE, 9);
  const localW = totalWidthWithTag;
  const localH = totalHeight;
  const startX = -localW / 2;
  const corners = [
    { x: startX, y: -localH / 2 }, { x: startX + localW, y: -localH / 2 },
    { x: startX + localW, y: localH / 2 }, { x: startX, y: localH / 2 }
  ];
  const rad = rot * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const finalCorners = corners.map(c => ({
    x: ox + dx + scale * (c.x * cos - c.y * sin),
    y: oy + dy + scale * (c.x * sin + c.y * cos)
  }));
  const el = svgRoot.getElementById(id);
  if (!el) return true;
  const polyPts = parsePoints(el.getAttribute('points'));
  if (polyPts.length === 0) return true;
  for (const pt of finalCorners) {
    if (!isPointInPolygon(pt.x, pt.y, polyPts)) return false;
  }
  return true;
}

function buildLabelsLayer() {
  if (!svgRoot) return;
  const labelsLayer = svgRoot.getElementById('labels');
  if (!labelsLayer) return;
  labelsLayer.querySelectorAll('.label-group').forEach(el => el.remove());
  labelsLayer.querySelectorAll('.label').forEach(txt => { txt.style.display = 'none'; });

  const colors = getLabelStyleColors();
  getAllTerritoryIds().forEach(id => {
    const allianceId = territoryAssignments[id];
    const info = getTerritoryLevelLabel(id);
    if (!info) return;

    const alliance = allianceId ? allianceMap[allianceId] : null;
    // Нераспределённую рисуем только если включены иконки или скрытый текст
    if (!alliance && !showUnassignedIcons && !showHiddenLabels) return;

    const cfg = labelSettings[id] || {};
    const srcTxt = labelsLayer.querySelector(`.label[data-id="${id}"]`);
    if (!srcTxt) return;
    const ox = parseFloat(srcTxt.getAttribute('x')) || 0;
    const oy = parseFloat(srcTxt.getAttribute('y')) || 0;

    const group = buildLabelGroup(id, info, alliance, cfg, ox, oy, colors);
    if (!group) return;
    group.setAttribute('class', 'label-group');
    group.setAttribute('data-id', id);
    group.setAttribute('pointer-events', 'none');
    labelsLayer.appendChild(group);
  });
}

export function getTerritoryType(id) {
  const m = String(id || '').match(/^([A-Z])/);
  return m ? m[1] : null;
}
export function getTerritoryLevel(id) {
  const s = String(id || '');
  const m = s.match(/^[A-Z](\d+)?-/);
  if (!m) return null;
  if (m[1]) return parseInt(m[1]);
  const parts = s.split('-');
  return (parts.length >= 2 && /^\d+$/.test(parts[1])) ? parseInt(parts[1]) : null;
}

export function getTerritoryLevelLabel(id) {
  const type = getTerritoryType(id);
  if (type === 'B') return { prefix: 'B', level: getTerritoryLevel(id), kind: 'bastion' };
  if (type === 'T') return { prefix: 'T', level: getTerritoryLevel(id), kind: 'trade' };
  if (type === 'A') return null;
  const lvl = LEVEL_BY_TYPE[type] || 0;
  return lvl ? { prefix: 'G', level: lvl, kind: 'city' } : null;
}

function safeParseViewBox(str) {
  if (typeof str !== 'string' || !str) return null;
  try {
    const parts = str.trim().split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n));
    if (parts.length !== 4 || parts[2] <= 0 || parts[3] <= 0) return null;
    return parts;
  } catch { return null; }
}

function pointOnSegment(px, py, x1, y1, x2, y2, eps = 1.5) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.abs(px - x1) < eps && Math.abs(py - y1) < eps;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  return Math.sqrt((px - nx) ** 2 + (py - ny) ** 2) < eps;
}

function isAdjacent(pts1, pts2, eps = 1.5) {
  for (const [x1, y1] of pts1) {
    for (const [x2, y2] of pts2) {
      if (Math.abs(x1 - x2) < eps && Math.abs(y1 - y2) < eps) return true;
    }
  }
  for (let i = 0; i < pts1.length; i++) {
    const [px, py] = pts1[i];
    for (let j = 0; j < pts2.length; j++) {
      const [x1, y1] = pts2[j];
      const [x2, y2] = pts2[(j + 1) % pts2.length];
      if (pointOnSegment(px, py, x1, y1, x2, y2, eps)) return true;
    }
  }
  for (let i = 0; i < pts2.length; i++) {
    const [px, py] = pts2[i];
    for (let j = 0; j < pts1.length; j++) {
      const [x1, y1] = pts1[j];
      const [x2, y2] = pts1[(j + 1) % pts1.length];
      if (pointOnSegment(px, py, x1, y1, x2, y2, eps)) return true;
    }
  }
  return false;
}

export function getNeighbors(id) {
  if (!svgRoot) return new Set();
  const el = svgRoot.getElementById(id);
  if (!el) return new Set();
  const pts = parsePoints(el.getAttribute('points'));
  const neighbors = new Set();
  svgRoot.querySelectorAll('.territory').forEach(other => {
    if (other.id === id || other.id === 'A') return;
    const otherPts = parsePoints(other.getAttribute('points'));
    if (isAdjacent(pts, otherPts)) neighbors.add(other.id);
  });
  return neighbors;
}

export function canSelectWithAdjacency(territoryId, selectedIds, adjacencyMode) {
  if (!adjacencyMode) return true;
  if (!selectedIds.length) return true;
  const neighbors = getNeighbors(territoryId);
  return selectedIds.some(sid => neighbors.has(sid));
}

function legendRow(kind, label) {
  const c = ICON_COLORS[kind];
  return `
    <div class="flex items-center gap-2">
      <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="${LEGEND_ICON_POINTS[kind]}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="0.8"/></svg>
      <span>${label}</span>
    </div>`;
}

function addTradeLegend(container) {
  if (!container || container.querySelector('.map-trade-legend')) return;
  const el = document.createElement('div');
  el.className = 'map-trade-legend flex flex-col gap-1 p-2 bg-white/90 dark:bg-gray-800/90 rounded border border-gray-300 dark:border-gray-600 text-xs shadow pointer-events-none';
  el.innerHTML = legendRow('city', 'Города') + legendRow('bastion', 'Бастионы') + legendRow('trade', 'Торговые посты');
  container.appendChild(el);
}

function showTerritoryInfo(id) {
  const type = getTerritoryType(id);
  const lvl = getTerritoryLevel(id);
  if (!type || !lvl) return;

  const typeLabel = TERRITORY_TYPES[type]?.label || 'Территория';
  const isBastion = type === 'B';
  const allianceId = territoryAssignments[id];
  const alliance = allianceId ? allianceMap[allianceId] : null;
  const iconKey = isBastion ? 'bastion' : 'city';
  const iconPts = LEGEND_ICON_POINTS[iconKey];
  const iconC = ICON_COLORS[iconKey];

  const iconHtml = `<svg width="16" height="16" viewBox="0 0 12 12"><polygon points="${iconPts}" fill="${iconC.fill}" stroke="${iconC.stroke}" stroke-width="0.8"/><text x="6" y="${isBastion ? '7' : '8'}" text-anchor="middle" fill="#fff" font-size="6" font-weight="bold">${lvl}</text></svg>`;

  let title = `${iconHtml} <span class="font-bold text-lg ml-1">${isBastion ? 'Бастион' : typeLabel}</span>`;
  
  let ownerHtml = '';
  if (alliance) {
    ownerHtml = `<div class="mt-2 text-gray-700 dark:text-gray-300">
      Занимает <span class="font-bold font-mono px-1 rounded" style="background:${alliance.color}22; color:${alliance.color}">${alliance.tag}</span>
      ${alliance.name ? `<span class="text-gray-500 ml-1">(${alliance.name})</span>` : ''}
    </div>`;
  } else {
    ownerHtml = `<div class="mt-2 text-gray-500 italic">Свободная территория</div>`;
  }

  const income = getTerritoryIncome(id);
  let incomeHtml = '';
  if (income > 0) {
    const resName = isBastion ? resourceNames.bastion : resourceNames.city;
    const resImg = isBastion ? 'assets/season_resource.png' : 'assets/season_resource_city.png';
    incomeHtml = `<div class="mt-3 flex items-center gap-2 text-sm bg-gray-50 dark:bg-gray-700/50 p-2 rounded">
      <span class="text-gray-500 dark:text-gray-400">Доход:</span>
      <img src="${resImg}" class="w-6 h-6 inline align-middle" onerror="this.style.display='none'">
      <span class="font-bold text-base">${income} ${resName}/ч</span>
    </div>`;
  } else {
    incomeHtml = `<div class="mt-2 text-gray-500 text-sm">Доход: —</div>`;
  }

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 opacity-0 transition-opacity duration-200';
  overlay.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-xs overflow-hidden transform scale-95 transition-transform duration-200">
      <div class="p-4">
        <div class="flex items-center mb-1">${title}</div>
        ${ownerHtml}
        ${incomeHtml}
        <button id="ti-close" class="w-full mt-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 py-1.5 rounded text-sm hover:bg-gray-300 dark:hover:bg-gray-600">Закрыть</button>
      </div>
    </div>
  `;
  
  const container = document.fullscreenElement || document.webkitFullscreenElement || document.body;
  container.appendChild(overlay);
  
  overlay.offsetHeight;
  overlay.classList.remove('opacity-0');
  overlay.querySelector('.transform').classList.remove('scale-95');

  const close = () => {
    overlay.classList.add('opacity-0');
    overlay.querySelector('.transform').classList.add('scale-95');
    setTimeout(() => overlay.remove(), 200);
  };

  overlay.querySelector('#ti-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

function addMapControls(container, pz, interactive, handleTerritoryClick, onFullscreenEditToggle) {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  let editMode = interactive && !isTouch;
  let panEnabled = isTouch ? true : !interactive;
  let isFullscreen = false;
  let fullscreenEditPanel = false;
  let savedEdit = editMode;
  let savedPan = panEnabled;
  const controls = document.createElement('div');
  controls.className = 'map-controls';
  container.style.position = 'relative';
  container.appendChild(controls);

  const render = () => {
    let html = `
      <button data-action="zoomIn" title="Увеличить"><i class="fas fa-search-plus"></i></button>
      <button data-action="zoomOut" title="Уменьшить"><i class="fas fa-search-minus"></i></button>
      <button data-action="reset" title="Сбросить вид"><i class="fas fa-compress-arrows-alt"></i></button>
      <button data-action="fullscreen" title="${isFullscreen ? 'Выйти из полного экрана' : 'Во весь экран'}">
        <i class="fas fa-${isFullscreen ? 'compress' : 'expand'}"></i>
      </button>
    `;
    if (interactive) {
      if (isFullscreen) {
        html += `<button data-action="toggleFullscreenEdit" class="${fullscreenEditPanel ? 'active' : ''}" title="${fullscreenEditPanel ? 'Скрыть инструменты' : 'Инструменты редактирования'}"><i class="fas fa-tools"></i></button>`;
      } else {
        const editTitle = editMode ? 'Редактирование включено' : 'Редактирование выключено';
        html += `<button data-action="toggleEdit" class="${editMode ? 'active' : ''}" title="${editTitle}"><i class="fas fa-pen"></i></button>`;
      }
    }
    if (!isFullscreen) {
      // В режиме перетаскивания подписей карта не двигается — кнопка это показывает
      const panActive = panEnabled && !isDragMode;
      const panTitle = isDragMode
        ? 'Перемещение отключено: включён режим размещения подписей'
        : (panEnabled ? 'Перемещение включено' : 'Перемещение выключено');
      html += `<button data-action="togglePan" class="${panActive ? 'active' : ''}" title="${panTitle}"><i class="fas fa-arrows-alt"></i></button>`;
    }
    controls.innerHTML = html;
  };

  const applyInteraction = () => {
    container.style.touchAction = 'none';
    const svg = container.querySelector('svg');
    if (svg) {
      svg.style.touchAction = 'none';
      svg.querySelectorAll('*').forEach(el => { el.style.touchAction = 'none'; });
    }
    // В режиме перетаскивания подписей карта не должна двигаться под пальцем/курсором
    const allowPan = panEnabled && !isDragMode;
    if (allowPan) { pz.enablePan(); } else { pz.disablePan(); }
    pz.enableZoom();
  };
  // setDragMode() из страницы перекрашивает взаимодействие через этот хук
  refreshPanState = () => { applyInteraction(); render(); };

  render();
  applyInteraction();

  let tapData = null, scrollTouchY = null, scrollMoved = false;
  const TAP_THRESHOLD = 10, SCROLL_THRESHOLD = 5, TAP_TIME_LIMIT = 600;

  const onPointerDown = (e) => {
    if (!interactive || !isDragMode) return;
    // Двумя пальцами — это пинч-зум, а не перетаскивание подписи
    if (e.touches && e.touches.length > 1) { cancelLabelDrag(); return; }
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    let el = document.elementFromPoint(clientX, clientY);
    if (el && el.closest && el.closest('#labels')) el = null;
    const territory = el && el.closest ? el.closest('.territory') : null;
    
    if (territory && territory.id !== 'A' && territory.classList.contains('selected')) {
      dragTargetId = territory.id;
      const settings = labelSettings[dragTargetId] || {};
      dragStartSettings = { 
        dx: settings.dx || 0, 
        dy: settings.dy || 0,
        rotation: settings.rotation || 0,
        scale: settings.scale || 1
      };
      
      const svgPoint = svgRoot.createSVGPoint();
      svgPoint.x = clientX;
      svgPoint.y = clientY;
      const ctm = svgRoot.getScreenCTM().inverse();
      const localPt = svgPoint.matrixTransform(ctm);
      dragStartPoint = { x: localPt.x, y: localPt.y };
      
      isDragging = true;
      if (e.cancelable) e.preventDefault();
    }
  };

  const onPointerMove = (e) => {
    if (!isDragging || !dragTargetId) return;
    if (e.touches && e.touches.length > 1) { cancelLabelDrag(); return; }
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const svgPoint = svgRoot.createSVGPoint();
    svgPoint.x = clientX;
    svgPoint.y = clientY;
    const ctm = svgRoot.getScreenCTM().inverse();
    const localPt = svgPoint.matrixTransform(ctm);
    
    const deltaX = localPt.x - dragStartPoint.x;
    const deltaY = localPt.y - dragStartPoint.y;
    
    if (!labelSettings[dragTargetId]) labelSettings[dragTargetId] = { rotation: 0, scale: 1 };
    labelSettings[dragTargetId].dx = (dragStartSettings.dx || 0) + deltaX;
    labelSettings[dragTargetId].dy = (dragStartSettings.dy || 0) + deltaY;
    
    buildLabelsLayer();
    if (e.cancelable) e.preventDefault();
  };

  const onPointerUp = () => {
    if (isDragging && dragTargetId) {
      const finalSettings = labelSettings[dragTargetId];
      saveLabelSettings({ [dragTargetId]: finalSettings });
      if (typeof window.updateSlidersFromSelection === 'function') window.updateSlidersFromSelection();
    }
    isDragging = false;
    dragTargetId = null;
    dragStartSettings = null;
    dragStartPoint = null;
  };

  container.addEventListener('mousedown', onPointerDown);
  container.addEventListener('mousemove', onPointerMove);
  container.addEventListener('mouseup', onPointerUp);
  container.addEventListener('mouseleave', onPointerUp);
  container.addEventListener('touchstart', onPointerDown, { passive: false });
  container.addEventListener('touchmove', onPointerMove, { passive: false });
  container.addEventListener('touchend', onPointerUp);
  container.addEventListener('touchcancel', onPointerUp);

  // ─── Пинч-зум двумя пальцами ───
  // svg-pan-zoom 3.6.1 не умеет масштабировать двумя пальцами: он всегда читает
  // только touches[0] (touchZoomEnabled/enableTouchZoom в этой версии отсутствуют).
  // Поэтому жест обрабатываем сами и зовём публичный zoomAtPoint.
  let pinchStartDist = 0;

  const touchDistance = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

  /** Переводит экранную точку в координаты SVG (их ждёт zoomAtPoint). */
  const toSvgPoint = (clientX, clientY) => {
    const ctm = svgRoot.getScreenCTM();
    if (!ctm) return null;
    const pt = svgRoot.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(ctm.inverse());
  };

  const onPinchStart = (e) => {
    if (e.touches.length !== 2) { pinchStartDist = 0; return; }
    cancelLabelDrag();
    tapData = null;              // пинч — не тап по территории
    // Библиотека начнёт панорамирование по первому пальцу — на время жеста
    // гасим pan, иначе карта «уползает» под масштабированием.
    pz.disablePan();
    pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
    if (e.cancelable) e.preventDefault();
  };

  const onPinchMove = (e) => {
    if (e.touches.length !== 2 || !pinchStartDist) return;
    if (e.cancelable) e.preventDefault();

    const dist = touchDistance(e.touches[0], e.touches[1]);
    if (!dist) return;

    // Масштабируем относительно середины между пальцами
    const center = toSvgPoint(
      (e.touches[0].clientX + e.touches[1].clientX) / 2,
      (e.touches[0].clientY + e.touches[1].clientY) / 2,
    );
    if (center) pz.zoomAtPointBy(dist / pinchStartDist, center);

    pinchStartDist = dist;
    container._suppressClick = true;
  };

  const onPinchEnd = (e) => {
    if (e.touches.length >= 2) return;
    if (pinchStartDist) {
      pinchStartDist = 0;
      applyInteraction();        // возвращаем pan согласно текущим режимам
      setTimeout(() => { container._suppressClick = false; }, 250);
    }
  };

  container.addEventListener('touchstart', onPinchStart, { passive: false });
  container.addEventListener('touchmove', onPinchMove, { passive: false });
  container.addEventListener('touchend', onPinchEnd, { passive: true });
  container.addEventListener('touchcancel', onPinchEnd, { passive: true });

  const onTouchStart = (e) => {
    if (isDragMode) return;
    if (e.touches.length !== 1) { tapData = null; return; }
    const t = e.touches[0];
    tapData = { x: t.clientX, y: t.clientY, time: Date.now(), moved: false };
    if (!panEnabled) scrollTouchY = t.clientY;
  };

  const onTouchMove = (e) => {
    if (isDragMode) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (tapData && !tapData.moved) {
      const dx = Math.abs(t.clientX - tapData.x);
      const dy = Math.abs(t.clientY - tapData.y);
      if (dx > TAP_THRESHOLD || dy > TAP_THRESHOLD) tapData.moved = true;
    }
    if (!panEnabled && scrollTouchY !== null) {
      const dy = scrollTouchY - t.clientY;
      if (Math.abs(dy) > SCROLL_THRESHOLD) { scrollMoved = true; window.scrollBy(0, dy); scrollTouchY = t.clientY; }
    }
  };

  const onTouchEnd = (e) => {
    if (isDragMode) return;
    let handled = false;
    if (tapData && !tapData.moved && !scrollMoved) {
      const dt = Date.now() - tapData.time;
      if (dt < TAP_TIME_LIMIT) {
        const touch = e.changedTouches && e.changedTouches[0];
        if (touch) {
          let el = document.elementFromPoint(touch.clientX, touch.clientY);
          if (el && el.closest && el.closest('#labels')) el = null;
          const territory = el && el.closest ? el.closest('.territory') : null;
          if (territory && interactive && !isFullscreen && editMode) {
            handled = true;
            try { handleTerritoryClick(territory.id, territory); } catch (err) { console.error(err); }
          }
        }
      }
    }
    if (handled || scrollMoved || (tapData && tapData.moved)) {
      container._suppressClick = true;
      setTimeout(() => { container._suppressClick = false; }, 250);
    }
    tapData = null; scrollTouchY = null; scrollMoved = false;
  };

  const onTouchCancel = () => { tapData = null; scrollTouchY = null; scrollMoved = false; };
  
  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEnd, { passive: true });
  container.addEventListener('touchcancel', onTouchCancel, { passive: true });

  const enterFullscreen = async () => {
    savedEdit = editMode; savedPan = panEnabled; editMode = false; panEnabled = true; isFullscreen = true; fullscreenEditPanel = false;
    render(); applyInteraction(); container.classList.add('is-fullscreen');
    try {
      if (container.requestFullscreen) await container.requestFullscreen();
      else if (container.webkitRequestFullscreen) await container.webkitRequestFullscreen();
      else if (container.msRequestFullscreen) await container.msRequestFullscreen();
      else { container.classList.add('fullscreen-fallback'); document.body.classList.add('no-scroll'); }
    } catch (e) {}
    setTimeout(() => { pz.resize(); pz.fit(); pz.center(); }, 200);
  };

  const exitFullscreen = async () => {
    isFullscreen = false; fullscreenEditPanel = false; container.classList.remove('is-fullscreen', 'fullscreen-fallback'); document.body.classList.remove('no-scroll');
    editMode = savedEdit; panEnabled = savedPan; render(); applyInteraction();
    if (onFullscreenEditToggle) onFullscreenEditToggle(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.webkitFullscreenElement) await document.webkitExitFullscreen();
    } catch (e) {}
    setTimeout(() => { pz.resize(); pz.fit(); pz.center(); }, 200);
  };

  const onFsChange = () => {
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!active && isFullscreen) exitFullscreen();
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  controls.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'zoomIn') pz.zoomIn();
    else if (action === 'zoomOut') pz.zoomOut();
    else if (action === 'reset') { pz.resize(); pz.fit(); pz.center(); }
    else if (action === 'toggleEdit') { if (isFullscreen) return; editMode = !editMode; render(); }
    else if (action === 'toggleFullscreenEdit') {
      if (!isFullscreen) return;
      fullscreenEditPanel = !fullscreenEditPanel;
      editMode = fullscreenEditPanel;
      render();
      if (onFullscreenEditToggle) onFullscreenEditToggle(fullscreenEditPanel);
    }
    else if (action === 'togglePan') { if (isFullscreen) return; panEnabled = !panEnabled; render(); applyInteraction(); }
    else if (action === 'fullscreen') { if (isFullscreen) await exitFullscreen(); else await enterFullscreen(); }
  });
  container._getEditMode = () => editMode;
}

export async function initMap({ containerId, interactive = false, clickHandler = null, onFullscreenEditToggle = null }) {
  const container = document.getElementById(containerId);
  try {
    const res = await fetch('assets/map.svg');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    originalSvgText = await res.text();
    container.innerHTML = originalSvgText;
  } catch (e) {
    container.innerHTML = `<div class="p-6 text-center text-red-500"><p class="font-bold">Ошибка карты: ${e.message}</p></div>`;
    return null;
  }
  svgRoot = container.querySelector('svg');
  if (!svgRoot) return null;
  originalSvgViewBox = safeParseViewBox(svgRoot.getAttribute('viewBox')) || [...FALLBACK_VIEWBOX];
  svgRoot.removeAttribute('width'); svgRoot.removeAttribute('height');
  addTradeLegend(container);

  await loadResourceNames();

  const handleTerritoryClick = (id, el) => {
    if (container._suppressClick) return;
    if (!interactive) {
      showTerritoryInfo(id);
      return;
    }
    if (container.classList.contains('is-fullscreen') && !container._getEditMode()) {
      showTerritoryInfo(id);
      return;
    }
    if (!container._getEditMode()) {
      showTerritoryInfo(id);
      return;
    }
    if (clickHandler) clickHandler(id, el); else toggleSelection(el);
  };

  if (typeof svgPanZoom === 'function') {
    try {
      panZoom = svgPanZoom(svgRoot, { 
        zoomEnabled: true, 
        controlIconsEnabled: false, 
        fit: true, 
        center: true, 
        minZoom: 0.4, 
        maxZoom: 12, 
        zoomScaleSensitivity: 0.4, 
        preventClickEventEnabled: false
      });
      
      panZoom.enableZoom();

      // Пинч-зум обрабатывается в addMapControls (своими touch-обработчиками):
      // библиотека 3.6.1 не умеет масштабировать двумя пальцами, а жёсткий
      // preventDefault здесь отменял жест ещё до нашего обработчика.

      const doFit = () => { try { panZoom.resize(); panZoom.fit(); panZoom.center(); } catch (e) {} };
      doFit(); requestAnimationFrame(doFit); setTimeout(doFit, 150); setTimeout(doFit, 500);
      try {
        let lastW = 0, lastH = 0;
        new ResizeObserver(() => {
          const w = container.clientWidth, h = container.clientHeight;
          if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) { lastW = w; lastH = h; doFit(); }
        }).observe(container);
      } catch (e) {}
      addMapControls(container, panZoom, interactive, handleTerritoryClick, onFullscreenEditToggle);
    } catch (e) {}
  }

  await loadAllData();
  svgRoot.querySelectorAll('.territory').forEach(t => {
    t.addEventListener('click', (e) => { e.stopPropagation(); handleTerritoryClick(t.id, t); });
  });

  new MutationObserver(() => { buildLabelsLayer(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  applyAll();
  return { panZoom, svgRoot };
}

export function setupLabelsToggle(buttonId) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  let visible = localStorage.getItem(LABELS_STATE_KEY) !== 'false';
  const updateBtn = () => {
    if (visible) { btn.innerHTML = '<i class="fas fa-eye mr-1"></i>Подписи вкл'; btn.classList.add('bg-green-600', 'text-white'); btn.classList.remove('bg-gray-200', 'dark:bg-gray-700'); }
    else { btn.innerHTML = '<i class="fas fa-eye-slash mr-1"></i>Подписи выкл'; btn.classList.remove('bg-green-600', 'text-white'); btn.classList.add('bg-gray-200', 'dark:bg-gray-700'); }
    toggleLabels(visible);
  };
  updateBtn();
  btn.addEventListener('click', () => { 
    visible = !visible; localStorage.setItem(LABELS_STATE_KEY, String(visible)); 
    updateBtn(); 
    if (typeof window.updateFsVisualToggles === 'function') window.updateFsVisualToggles();
  });
}

export function setupUnassignedIconsToggle(buttonId) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  let visible = localStorage.getItem(UNASSIGNED_ICONS_KEY) === 'true';
  showUnassignedIcons = visible;
  const updateBtn = () => {
    if (visible) { btn.innerHTML = '<i class="fas fa-layer-group mr-1"></i>Иконки вкл'; btn.classList.add('bg-indigo-600', 'text-white'); btn.classList.remove('bg-gray-200', 'dark:bg-gray-700'); }
    else { btn.innerHTML = '<i class="fas fa-layer-group mr-1"></i>Иконки выкл'; btn.classList.remove('bg-indigo-600', 'text-white'); btn.classList.add('bg-gray-200', 'dark:bg-gray-700'); }
    buildLabelsLayer();
  };
  updateBtn();
  btn.addEventListener('click', () => { visible = !visible; showUnassignedIcons = visible; 
    localStorage.setItem(UNASSIGNED_ICONS_KEY, String(visible)); 
    updateBtn(); 
    if (typeof window.updateFsVisualToggles === 'function') window.updateFsVisualToggles();
  });
}

// setHideUnassignedLabels удалён: он писал в переменную, которая нигде не
// читалась. Свободные территории и так не получают подпись, пока не включены
// «Иконки» (showUnassignedIcons) или «Скрытый текст» (showHiddenLabels).

function toggleSelection(el) {
  if (el.classList.contains('selected')) { el.classList.remove('selected'); selectedTerritories.delete(el.id); }
  else { el.classList.add('selected'); selectedTerritories.add(el.id); }
}

export function clearSelection() {
  if (!svgRoot) return;
  svgRoot.querySelectorAll('.territory.selected').forEach(t => t.classList.remove('selected'));
  selectedTerritories.clear();
}
export function getSelected() { return Array.from(selectedTerritories); }
export function selectTerritory(id, selected = true) {
  if (!svgRoot) return;
  const el = svgRoot.getElementById(id);
  if (!el) return;
  el.classList.toggle('selected', selected);
  if (selected) selectedTerritories.add(id); else selectedTerritories.delete(id);
}

export function selectAllFiltered(filterFn) {
  if (!svgRoot) return 0;
  let count = 0;
  getAllTerritoryIds().forEach(id => { if (!filterFn || filterFn(id)) { selectTerritory(id, true); count++; } });
  return count;
}

async function loadAllData() {
  const ls = await getDocs(collection(db, 'label_settings'));
  labelSettings = {};
  ls.forEach(d => labelSettings[d.id] = d.data());
  const al = await getDocs(collection(db, 'alliances'));
  allianceMap = {};
  al.forEach(d => allianceMap[d.id] = { id: d.id, ...d.data() });
  const tt = await getDocs(collection(db, 'territories'));
  territoryAssignments = {};
  tt.forEach(d => territoryAssignments[d.id] = d.data().allianceId);
}

export function applyAll() { applyTerritoryColors(); buildLabelsLayer(); }

export function applyTerritoryColors(assignments = null, alliances = null) {
  if (!svgRoot) return;
  const a = alliances || allianceMap;
  const as = assignments || territoryAssignments;
  svgRoot.querySelectorAll('.territory').forEach(t => {
    const allianceId = as[t.id];
    if (allianceId && a[allianceId]) t.style.fill = a[allianceId].color;
    else t.style.fill = '';
  });
}

export function applyLabelTexts(assignments = null, alliances = null) {
  if (assignments) territoryAssignments = assignments;
  if (alliances) allianceMap = alliances;
  buildLabelsLayer();
}

export function applyLabelSettings(settings = null) {
  if (settings) labelSettings = settings;
  buildLabelsLayer();
}

export function toggleLabels(show) {
  if (!svgRoot) return;
  const layer = svgRoot.getElementById('labels');
  if (layer) layer.style.display = show ? 'block' : 'none';
}

export function getLabelSettings() { return { ...labelSettings }; }
export function setLabelSettings(s) { labelSettings = s; buildLabelsLayer(); }
export function setPreviewData(alliances, assignments) {
  allianceMap = alliances; territoryAssignments = assignments;
  applyTerritoryColors(assignments, alliances); buildLabelsLayer();
}

export async function saveLabelSettings(newSettings, replace = false) {
  const promises = [];
  for (const [id, cfg] of Object.entries(newSettings)) {
    if (replace) promises.push(setDoc(doc(db, 'label_settings', id), cfg));
    else promises.push(setDoc(doc(db, 'label_settings', id), cfg, { merge: true }));
  }
  await Promise.all(promises);
  labelSettings = { ...labelSettings, ...newSettings };
  buildLabelsLayer();
}

export function getTerritoryAssignments() { return { ...territoryAssignments }; }

export function computeAllianceStats(assignments) {
  const stats = {};
  for (const [tid, aid] of Object.entries(assignments || {})) {
    if (!aid) continue;
    if (!stats[aid]) stats[aid] = { bastions: 0, general: 0, trade: 0, total: 0 };
    const type = getTerritoryType(tid);
    if (type === 'B') stats[aid].bastions++;
    else if (type === 'T') stats[aid].trade++;
    else stats[aid].general++;
    stats[aid].total++;
  }
  return stats;
}

export async function exportMapPNG(withLabels, theme = 'light') {
  try {
    if (!originalSvgText) { toast('Карта ещё не загружена', 'error'); return; }
    const t = EXPORT_THEMES[theme] || EXPORT_THEMES.light;

    const parser = new DOMParser();
    const doc = parser.parseFromString(originalSvgText, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName === 'parsererror') throw new Error('Не удалось распарсить SVG');
    svg.removeAttribute('style'); svg.removeAttribute('width'); svg.removeAttribute('height');

    const labelsLayer = svg.getElementById('labels');
    if (labelsLayer && !withLabels) labelsLayer.remove();

    svg.querySelectorAll('.territory').forEach(terr => {
      const allianceId = territoryAssignments[terr.id];
      const alliance = allianceId ? allianceMap[allianceId] : null;
      terr.removeAttribute('class'); terr.removeAttribute('style');
      terr.style.fill = alliance ? alliance.color : t.emptyFill;
      const isTrade = getTerritoryType(terr.id) === 'T';
      terr.style.stroke = isTrade ? t.tradeStroke : t.territoryStroke;
      terr.style.strokeWidth = isTrade ? TRADE_STROKE_WIDTH + 'px' : '1px';
      if (terr.id === ARCADIA_ID) terr.style.fill = t.arcadiaFill;
    });

    if (withLabels && labelsLayer) {
      labelsLayer.querySelectorAll('.label-group, .label').forEach(el => el.remove());
      getAllTerritoryIds().forEach(id => {
        const allianceId = territoryAssignments[id];
        const info = getTerritoryLevelLabel(id);
        if (!info) return;

        const alliance = allianceId ? allianceMap[allianceId] : null;
        if (!alliance && !showHiddenLabels) return;

        const srcLabel = svgRoot.querySelector(`#labels .label[data-id="${id}"]`);
        if (!srcLabel) return;
        const ox = parseFloat(srcLabel.getAttribute('x')) || 0;
        const oy = parseFloat(srcLabel.getAttribute('y')) || 0;

        const group = buildLabelGroup(id, info, alliance, labelSettings[id] || {}, ox, oy,
          { fill: t.labelFill, stroke: t.labelStroke },
          { ns: SVG_NS, labelFill: t.labelFill, labelStroke: t.labelStroke });
        if (group) labelsLayer.appendChild(group);
      });
    }

    const vb = originalSvgViewBox || [...FALLBACK_VIEWBOX];
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('viewBox', vb.join(' ')); svg.setAttribute('width', String(vb[2])); svg.setAttribute('height', String(vb[3]));
    const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const width = 2000;
    const mapHeight = Math.round(width * vb[3] / vb[2]);

    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });

    const legend = buildLegend();
    const cols = Math.min(3, Math.max(1, Math.ceil(legend.length / 4)));
    const rows = legend.length ? Math.ceil(legend.length / cols) : 0;
    const L_FONT = 22, L_LINE = 50, L_PAD = 24, L_SWATCH = 20;
    const legendHeight = legend.length ? L_PAD * 2 + rows * L_LINE : 0;

    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = mapHeight + legendHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = t.canvasBg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, width, mapHeight);
    URL.revokeObjectURL(url);

    if (legend.length) {
      ctx.strokeStyle = t.legendLine; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, mapHeight); ctx.lineTo(width, mapHeight); ctx.stroke();
      const colWidth = width / cols;
      const totalTerr = (item) => item.bastions + item.general + item.trade;
      legend.forEach((item, i) => {
        const col = Math.floor(i / rows), row = i % rows;
        const x = L_PAD + col * colWidth, y = mapHeight + L_PAD + row * L_LINE + L_LINE / 2;
        ctx.fillStyle = item.color; ctx.fillRect(x, y - L_SWATCH / 2, L_SWATCH, L_SWATCH);
        ctx.strokeStyle = t.legendBorder; ctx.lineWidth = 1; ctx.strokeRect(x, y - L_SWATCH / 2, L_SWATCH, L_SWATCH);
        
        ctx.fillStyle = t.legendText; ctx.font = `bold ${L_FONT}px Arial, sans-serif`; ctx.textBaseline = 'middle';
        ctx.fillText(`${item.rank}. ${item.tag} — ${totalTerr(item)}  |  Б:${item.bastions} Г:${item.general} Т:${item.trade}`, x + L_SWATCH + 10, y - 8);
        
        let incStr = [];
        if (item.cityIncome > 0) incStr.push(`${resourceNames.city}: ${item.cityIncome}/ч`);
        if (item.bastionIncome > 0) incStr.push(`${resourceNames.bastion}: ${item.bastionIncome}/ч`);
        if (incStr.length > 0) {
          ctx.font = `${L_FONT - 4}px Arial, sans-serif`;
          ctx.fillText(incStr.join('  |  '), x + L_SWATCH + 10, y + 10);
        }
      });
    }

    const link = document.createElement('a');
    link.download = `map-217-${theme}-${withLabels ? 'labels' : 'plain'}-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error(err);
    toast('Ошибка экспорта PNG: ' + err.message, 'error');
  }
}

function buildLegend() {
  const stats = computeAllianceStats(territoryAssignments);
  const incomes = computeAllianceIncomes(territoryAssignments);
  const list = Object.values(allianceMap).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  return list.map((a, idx) => {
    const s = stats[a.id] || { bastions: 0, general: 0, trade: 0, total: 0 };
    const inc = incomes[a.id] || { city: 0, bastion: 0 };
    return { id: a.id, tag: a.tag, color: a.color, rank: idx + 1, cityIncome: inc.city, bastionIncome: inc.bastion, ...s };
  }).filter(item => item.total > 0);
}

export function getTerritoryTypes() { return TERRITORY_TYPES; }
export function getAllTerritoryIds() {
  if (!svgRoot) return [];
  return Array.from(svgRoot.querySelectorAll('.territory')).map(t => t.id).filter(id => id !== 'A');
}
export function getFilteredTerritories(filters) {
  const ids = [];
  getAllTerritoryIds().forEach(id => {
    const type = getTerritoryType(id);
    if (type === 'B' || type === 'T') {
      const level = getTerritoryLevel(id);
      if (filters[type] && filters[type][level]) ids.push(id);
    } else {
      if (filters[type]) ids.push(id);
    }
  });
  return ids;
}

// ⭐ Функции для управления состоянием извне
export function isLabelsVisible() {
  return localStorage.getItem(LABELS_STATE_KEY) !== 'false';
}

export function isUnassignedIconsVisible() {
  return localStorage.getItem(UNASSIGNED_ICONS_KEY) === 'true';
}

export function toggleLabelsExternal() {
  const btn = document.getElementById('btn-toggle-labels');
  if (btn) btn.click();
}

export function toggleIconsExternal() {
  const btn = document.getElementById('btn-toggle-icons');
  if (btn) btn.click();
}

// ⭐ Функции для Скрытого текста (Админка)
export function isHiddenLabelsVisible() {
  return showHiddenLabels;
}

export function toggleHiddenLabelsExternal() {
  showHiddenLabels = !showHiddenLabels;
  buildLabelsLayer();
}