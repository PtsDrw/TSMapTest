// Общие константы проекта. Единый источник правды для map-core, manager, admin, visitor.

export const SVG_NS = 'http://www.w3.org/2000/svg';

// Ключи localStorage
export const STORAGE_KEYS = {
  theme: 'theme',
  labelsVisible: 'ts_labels_visible',
  unassignedIcons: 'ts_unassigned_icons',
  session: 'ts_session',
  legendCollapsed: 'ts_legend_collapsed',
  working: (keyId) => `ts_working_${keyId}`,
};

// Прямые экспорты для обратной совместимости с map-core.js
export const LABELS_STATE_KEY = STORAGE_KEYS.labelsVisible;
export const UNASSIGNED_ICONS_KEY = STORAGE_KEYS.unassignedIcons;
export const LEGEND_COLLAPSED_KEY = STORAGE_KEYS.legendCollapsed;

// Ширина экрана, на которой легенда по умолчанию свёрнута (мобильные)
export const LEGEND_MOBILE_QUERY = '(max-width: 767px)';

// Режимы редактирования
export const MODES = {
  territoryToAlliance: 'territory-to-alliance',
  allianceToTerritory: 'alliance-to-territory',
};

// Значения по умолчанию для размещения подписи
export const DEFAULT_LABEL_CFG = { dx: 0, dy: 0, rotation: 0, scale: 1 };

// Типы-«города» (всё, что не бастион и не торговый пост)
export const CITY_TYPES = ['D', 'Z', 'G', 'M', 'C', 'V'];

// Лимиты по умолчанию
export const DEFAULT_LIMITS = { cities: 6, bastions: 6, trade: Infinity };

// Названия ресурсов по умолчанию
export const DEFAULT_RESOURCE_NAMES = { city: 'Медь', bastion: 'Кварц' };

// Статусы раскладок для вывода в список
export const LAYOUT_STATUS = {
  draft: { label: 'Черновик', className: 'bg-gray-500' },
  pending: { label: 'На рассмотрении', className: 'bg-yellow-500' },
  rejected: { label: 'Отклонено', className: 'bg-red-600' },
  approved: { label: 'Утверждено', className: 'bg-green-600' },
};

// ═══ SVG-карта ═══
export const FALLBACK_VIEWBOX = [-10, -10, 550, 542];
export const TRADE_STROKE_LIGHT = '#f59e0b';
export const TRADE_STROKE_DARK = '#fbbf24';
export const TRADE_STROKE_WIDTH = '2.5';

export const ICON_SIZE = 10;
export const ICON_HALF = ICON_SIZE / 2;
export const ICON_GAP = 2;

// Палитры иконок/подписей
export const ICON_COLORS = {
  bastion: { fill: '#7c3aed', stroke: '#1e1b4b' },
  trade: { fill: '#f59e0b', stroke: '#7c2d12' },
  city: { fill: '#3b82f6', stroke: '#1e3a8a' },
};
export const ICON_TEXT_COLORS = { trade: '#7c2d12', bastion: '#ffffff', city: '#ffffff' };

// Вершины иконок для viewBox 0 0 12 12 (легенда, модалка информации)
export const LEGEND_ICON_POINTS = {
  bastion: '6,0 12,0 12,9 6,12 0,9 0,0',
  trade: '6,0 12,6 6,12 0,6',
  city: '0,5 6,0 12,5 12,12 0,12',
};

// Цвета обводки «не влезшего»/шаблонного текста
export const LABEL_OVERFLOW_STROKE = '#ef4444';
export const LABEL_TEMPLATE_STROKE = '#3b82f6';

// ═══ Типы территорий ═══
const CITY_INCOME = [0, 3, 5, 10, 15, 25, 50];

export const TERRITORY_TYPES = {
  D: { label: 'Деревни', subs: false, income: CITY_INCOME },
  Z: { label: 'Заводы', subs: false, income: CITY_INCOME },
  G: { label: 'Городки', subs: false, income: CITY_INCOME },
  M: { label: 'Мегаполисы', subs: false, income: CITY_INCOME },
  C: { label: 'Центры исследований', subs: false, income: CITY_INCOME },
  V: { label: 'Военные комплексы', subs: false, income: CITY_INCOME },
  B: { label: 'Бастионы', subs: true, levels: [1, 2, 3, 4, 5, 6], income: [0, 6, 12, 18, 30, 42, 60] },
  T: { label: 'Торговые посты', subs: true, levels: [1, 2, 3, 4, 5], income: [0, 0, 0, 0, 0, 0] },
};

export const LEVEL_BY_TYPE = { D: 1, Z: 2, G: 3, M: 4, C: 5, V: 6 };

// ═══ Стили экспорта PNG ═══
export const EXPORT_THEMES = {
  light: {
    canvasBg: '#ffffff',
    emptyFill: '#ffffff',
    arcadiaFill: '#f4f4f4',
    territoryStroke: '#000000',
    tradeStroke: TRADE_STROKE_LIGHT,
    labelFill: '#000000',
    labelStroke: '#ffffff',
    legendLine: '#cccccc',
    legendText: '#000000',
    legendBorder: '#000000',
    legendBg: 'rgba(255, 255, 255, 0.92)',
  },
  dark: {
    canvasBg: '#1e293b',
    emptyFill: '#334155',
    arcadiaFill: '#0f172a',
    territoryStroke: '#94a3b8',
    tradeStroke: TRADE_STROKE_DARK,
    labelFill: '#ffffff',
    labelStroke: '#000000',
    legendLine: '#334155',
    legendText: '#e2e8f0',
    legendBorder: '#64748b',
    legendBg: 'rgba(30, 41, 59, 0.92)',
  },
};

// ═══ Общие CSS-классы кнопок тулбара ═══
export const TOOL_BTN = {
  base: 'px-3 py-1 rounded text-sm',
  off: 'bg-gray-200 dark:bg-gray-700',
  labelsOn: 'bg-green-600 text-white',
  iconsOn: 'bg-indigo-600 text-white',
  hiddenOn: 'bg-orange-600 text-white',
};

export const FS_TOOL_BTN = {
  base: 'px-2 py-1 text-xs rounded',
  off: 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200',
  labelsOn: 'bg-green-600 text-white',
  iconsOn: 'bg-indigo-600 text-white',
};

// ═══ Иконки Font Awesome ═══
export const ICONS = {
  eye: '<i class="fas fa-eye mr-1"></i>',
  eyeSlash: '<i class="fas fa-eye-slash mr-1"></i>',
  layers: '<i class="fas fa-layer-group mr-1"></i>',
};

// ═══ Прочее ═══
export const TAG_PATTERN = /^[A-ZА-ЯЁ0-9]{3}$/;
export const ARCADIA_ID = 'A';
export const TEMPLATE_TAG = 'XXX';

// Классы «серых» контролов, которые гасятся, пока режим подписей выключен
export const DISABLED_CLASSES = ['opacity-50', 'pointer-events-none'];
