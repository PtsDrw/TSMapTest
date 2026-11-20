import { db } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { initTheme, toast } from './utils.js';
import {
  initMap, setupLabelsToggle, exportMapPNG, getTerritoryAssignments,
  computeAllianceStats, computeAllianceIncomes,
  flashAllianceTerritories, scrollToMap,
} from './map-core.js';
import { renderAlliancesRanking } from './common-ui.js';
import { loginWithKey, loginAdmin, validateSession } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuthModal();
  initMapAndData();
});

async function initMapAndData() {
  const map = await initMap({ containerId: 'map-container', interactive: false });
  if (!map) return;

  setupLabelsToggle('btn-toggle-labels');

  await renderAlliancesList();

  document.getElementById('btn-download').addEventListener('click', () => {
    document.getElementById('modal-download').classList.remove('hidden');
  });
  document.getElementById('modal-download').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-download]');
    if (!btn) return;
    const [theme, mode] = btn.dataset.download.split('-');
    document.getElementById('modal-download').classList.add('hidden');
    await exportMapPNG(mode === 'labels', theme);
  });
  document.getElementById('btn-close-download').addEventListener('click', () => {
    document.getElementById('modal-download').classList.add('hidden');
  });
}

async function renderAlliancesList() {
  const list = document.getElementById('alliances-list');
  const snap = await getDocs(collection(db, 'alliances'));
  const alliances = [];
  snap.forEach(d => alliances.push({ id: d.id, ...d.data() }));
  alliances.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  const assignments = getTerritoryAssignments();

  renderAlliancesRanking(list, alliances, {
    stats: computeAllianceStats(assignments),
    incomes: computeAllianceIncomes(assignments),
    layout: 'row',
    actions: false,
    showOnMap: 'flash',
    onShowOnMap: (id) => {
      const count = flashAllianceTerritories(id, 5000);
      scrollToMap('map-container');
      if (!count) toast('У этого союза нет территорий', 'error');
    },
  });
}

function initAuthModal() {
  const modal = document.getElementById('modal-auth');
  const step1 = document.getElementById('auth-step-1');
  const step2 = document.getElementById('auth-step-2');
  const btnAdmin = document.getElementById('btn-admin');

  // ⭐ Клик по "217 штат — управление": сначала проверяем существующую сессию
  btnAdmin.addEventListener('click', async () => {
    // Защита от двойного клика + визуальный отклик
    if (btnAdmin.disabled) return;
    const originalHTML = btnAdmin.innerHTML;
    btnAdmin.disabled = true;
    btnAdmin.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Проверка...';

    try {
      const session = await validateSession();

      if (session) {
        if (session.type === 'admin') {
          toast(`Вы вошли как ${session.email || 'администратор'}`, 'success');
          window.location.href = 'admin.html';
          return;
        }
        if (session.type === 'manager') {
          toast(`Вы вошли как ${session.name}${session.isMainManager ? ' (Главный)' : ''}`, 'success');
          window.location.href = 'manager.html';
          return;
        }
      }
    } catch (e) {
      console.warn('[visitor] validateSession failed:', e);
      // Не мешаем пользователю — просто показываем модалку
    }

    // ⭐ Нет валидной сессии — показываем модалку входа
    btnAdmin.disabled = false;
    btnAdmin.innerHTML = originalHTML;
    step1.classList.remove('hidden');
    step2.classList.add('hidden');
    document.getElementById('access-key').value = '';
    document.getElementById('admin-login').value = '';
    document.getElementById('admin-pass').value = '';
    modal.classList.remove('hidden');
  });

  document.getElementById('btn-close-auth').addEventListener('click', () => modal.classList.add('hidden'));

  document.getElementById('btn-admin-auth').addEventListener('click', () => {
    step1.classList.add('hidden');
    step2.classList.remove('hidden');
  });
  document.getElementById('btn-back-auth').addEventListener('click', () => {
    step2.classList.add('hidden');
    step1.classList.remove('hidden');
  });

  document.getElementById('btn-login-key').addEventListener('click', async () => {
    const key = document.getElementById('access-key').value;
    if (!key.trim()) return toast('Введите ключ доступа', 'error');
    try {
      await loginWithKey(key);
      toast('Успешно', 'success');
      window.location.href = 'manager.html';
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  // Enter в поле ключа → войти
  document.getElementById('access-key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-login-key').click();
  });

  document.getElementById('btn-do-admin-login').addEventListener('click', async () => {
    const email = document.getElementById('admin-login').value;
    const pass = document.getElementById('admin-pass').value;
    if (!email || !pass) return toast('Введите email и пароль', 'error');
    try {
      await loginAdmin(email, pass);
      toast('Успешно', 'success');
      window.location.href = 'admin.html';
    } catch (e) {
      toast('Ошибка входа: ' + e.message, 'error');
    }
  });

  // Enter в пароле → войти
  document.getElementById('admin-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-do-admin-login').click();
  });
}