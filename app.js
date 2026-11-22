// ==========================================
// FinMate Frontend Logic (PWA + Sheets Sync)
// ==========================================

const CATEGORIES = {
  expense: ['อาหารและเครื่องดื่ม', 'เดินทาง', 'ช้อปปิ้ง', 'บิลและสาธารณูปโภค', 'บันเทิง', 'สุขภาพ', 'อื่นๆ'],
  income: ['เงินเดือน', 'รายได้เสริม', 'โบนัส', 'เงินคืน/หารบิล', 'อื่นๆ']
};

let state = {
  gasUrl: localStorage.getItem('finmate_gas_url') || '',
  wallets: JSON.parse(localStorage.getItem('finmate_wallets')) || [
    { id: 'w_cash', name: 'เงินสด', type: 'cash', balance: 0, color: '#10B981' },
    { id: 'w_bank1', name: 'บัญชีธนาคารหลัก', type: 'bank', balance: 0, color: '#3B82F6' }
  ],
  transactions: JSON.parse(localStorage.getItem('finmate_tx')) || [],
  goals: JSON.parse(localStorage.getItem('finmate_goals')) || [],
  budgets: JSON.parse(localStorage.getItem('finmate_budgets')) || [],
  splits: JSON.parse(localStorage.getItem('finmate_splits')) || []
};

let chartInstance = null;

// --- 1. Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if (localStorage.getItem('finmate_theme') === 'dark') {
    document.documentElement.classList.add('dark');
  }

  document.getElementById('tx-date').valueAsDate = new Date();
  document.getElementById('filter-month').value = new Date().toISOString().slice(0, 7);
  document.getElementById('gas-url-input').value = state.gasUrl;

  populateDropdowns();
  renderAll();

  if (state.gasUrl) {
    syncData(false);
  }
});

// --- 2. Google Sheets Sync ---
async function syncData(showAlert = false) {
  if (!state.gasUrl) {
    if (showAlert) alert('กรุณาวาง Google Apps Script URL ในหน้าตั้งค่าก่อนครับ');
    return;
  }
  const statusEl = document.getElementById('sync-status');
  statusEl.textContent = 'กำลังซิงค์...';

  try {
    const res = await fetch(state.gasUrl);
    const json = await res.json();
    if (json.status === 'success') {
      state.wallets = json.data.wallets.length ? json.data.wallets : state.wallets;
      state.transactions = json.data.transactions || [];
      state.goals = json.data.goals || [];
      state.budgets = json.data.budgets || [];
      state.splits = (json.data.splits || []).map(s => ({
        ...s,
        members: typeof s.membersJson === 'string' ? JSON.parse(s.membersJson) : (s.members || [])
      }));
      saveLocalState();
      populateDropdowns();
      renderAll();
      statusEl.textContent = 'ซิงค์ล่าสุด ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    }
  } catch (err) {
    statusEl.textContent = 'ออฟไลน์ (ใช้ข้อมูลในเครื่อง)';
  }
}

async function postToSheets(action, data) {
  saveLocalState();
  renderAll();
  if (!state.gasUrl) return;

  const statusEl = document.getElementById('sync-status');
  statusEl.textContent = 'กำลังบันทึก...';
  try {
    await fetch(state.gasUrl, {
      method: 'POST',
      body: JSON.stringify({ action, data })
    });
    statusEl.textContent = 'บันทึกขึ้น Cloud แล้ว ✓';
  } catch (err) {
    statusEl.textContent = 'บันทึกในเครื่อง (รอซิงค์)';
  }
}

function saveLocalState() {
  localStorage.setItem('finmate_wallets', JSON.stringify(state.wallets));
  localStorage.setItem('finmate_tx', JSON.stringify(state.transactions));
  localStorage.setItem('finmate_goals', JSON.stringify(state.goals));
  localStorage.setItem('finmate_budgets', JSON.stringify(state.budgets));
  localStorage.setItem('finmate_splits', JSON.stringify(state.splits));
}

// --- 3. Handlers (Transactions, Wallets, Splits, Goals, Budgets) ---
function handleAddTransaction(e) {
  e.preventDefault();
  const type = document.querySelector('input[name="tx-type"]:checked').value;
  const amount = parseFloat(document.getElementById('tx-amount').value);
  const category = document.getElementById('tx-category').value;
  const walletId = document.getElementById('tx-wallet').value;
  const date = document.getElementById('tx-date').value;
  const note = document.getElementById('tx-note').value;

  const tx = { id: 'tx_' + Date.now(), type, amount, category, walletId, date, note };
  state.transactions.unshift(tx);

  const wallet = state.wallets.find(w => w.id === walletId);
  if (wallet) wallet.balance = Number(wallet.balance) + (type === 'income' ? amount : -amount);

  e.target.reset();
  document.getElementById('tx-date').valueAsDate = new Date();
  closeModal('modal-tx');
  postToSheets('addTransaction', tx);
}

function deleteTransaction(id) {
  if (!confirm('ต้องการลบรายการนี้ใช่ไหม?')) return;
  const idx = state.transactions.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tx = state.transactions[idx];
  const wallet = state.wallets.find(w => w.id === tx.walletId);
  if (wallet) wallet.balance = Number(wallet.balance) + (tx.type === 'income' ? -Number(tx.amount) : Number(tx.amount));
  state.transactions.splice(idx, 1);
  postToSheets('deleteTransaction', tx);
}

function handleAddWallet(e) {
  e.preventDefault();
  const w = {
    id: 'w_' + Date.now(),
    name: document.getElementById('w-name').value,
    type: 'bank',
    balance: parseFloat(document.getElementById('w-balance').value),
    color: document.getElementById('w-color').value
  };
  state.wallets.push(w);
  populateDropdowns();
  e.target.reset();
  closeModal('modal-wallet');
  postToSheets('addWallet', w);
}

function handleAddSplit(e) {
  e.preventDefault();
  const title = document.getElementById('sp-title').value;
  const totalAmount = parseFloat(document.getElementById('sp-total').value);
  const names = document.getElementById('sp-members').value.split(',').map(s => s.trim()).filter(Boolean);
  const perPerson = Number((totalAmount / (names.length + 1)).toFixed(2));

  const split = {
    id: 'sp_' + Date.now(),
    title,
    totalAmount,
    date: new Date().toISOString().split('T')[0],
    status: 'pending',
    members: names.map(name => ({ name, amount: perPerson, paid: false }))
  };
  state.splits.unshift(split);
  e.target.reset();
  closeModal('modal-split');
  postToSheets('saveSplit', split);
}

function toggleSplitMemberPaid(splitId, memberIdx) {
  const split = state.splits.find(s => s.id === splitId);
  if (!split) return;
  split.members[memberIdx].paid = !split.members[memberIdx].paid;
  split.status = split.members.every(m => m.paid) ? 'completed' : 'pending';
  postToSheets('saveSplit', split);
}

function handleAddGoal(e) {
  e.preventDefault();
  const g = {
    id: 'g_' + Date.now(),
    title: document.getElementById('g-title').value,
    targetAmount: parseFloat(document.getElementById('g-target').value),
    currentAmount: 0,
    deadline: document.getElementById('g-deadline').value
  };
  state.goals.push(g);
  e.target.reset();
  closeModal('modal-goal');
  postToSheets('addGoal', g);
}

function depositToGoal(goalId) {
  const amt = parseFloat(prompt('ระบุจำนวนเงินที่ต้องการออมเพิ่ม (บาท):'));
  if (!amt || amt <= 0) return;
  const g = state.goals.find(item => item.id === goalId);
  if (g) g.currentAmount = Number(g.currentAmount) + amt;
  postToSheets('depositGoal', { goalId, amount: amt });
}

function handleSaveBudget(e) {
  e.preventDefault();
  const category = document.getElementById('budget-category').value;
  const limitAmount = parseFloat(document.getElementById('budget-limit').value);
  const existing = state.budgets.find(b => b.category === category);
  if (existing) existing.limitAmount = limitAmount;
  else state.budgets.push({ category, limitAmount });
  document.getElementById('budget-limit').value = '';
  postToSheets('saveBudget', { category, limitAmount });
}

// --- 4. Bank Reconciliation ---
function calculateReconcile() {
  const walletId = document.getElementById('rec-wallet').value;
  const actualVal = document.getElementById('rec-actual').value;
  const resBox = document.getElementById('rec-result');
  if (actualVal === '') { resBox.classList.add('hidden'); return; }

  const wallet = state.wallets.find(w => w.id === walletId);
  const sysBal = Number(wallet.balance);
  const actBal = parseFloat(actualVal);
  const diff = Number((actBal - sysBal).toFixed(2));

  resBox.classList.remove('hidden');
  if (diff === 0) {
    resBox.innerHTML = `<p class="text-emerald-600 font-semibold">✅ ยอดเงินตรงกันเป๊ะ! (฿${sysBal.toLocaleString()})</p>`;
  } else {
    const label = diff > 0 ? `เงินในธนาคารเกินมา +฿${diff.toLocaleString()}` : `เงินหาย/ลืมบันทึก -฿${Math.abs(diff).toLocaleString()}`;
    resBox.innerHTML = `
      <div class="space-y-2">
        <p class="text-sm">ยอดในแอป: <b>฿${sysBal.toLocaleString()}</b> | ยอดจริง: <b>฿${actBal.toLocaleString()}</b></p>
        <p class="text-rose-500 font-semibold">⚠️ ${label}</p>
        <button onclick="applyReconcile('${walletId}', ${actBal}, ${diff})" class="px-4 py-2 rounded-xl bg-emerald-500 text-white text-xs font-medium">ปรับยอดในแอปให้ตรงอัตโนมัติ</button>
      </div>`;
  }
}

function applyReconcile(walletId, actualBalance, diff) {
  const wallet = state.wallets.find(w => w.id === walletId);
  if (wallet) wallet.balance = actualBalance;
  state.transactions.unshift({
    id: 'tx_' + Date.now(),
    type: diff > 0 ? 'income' : 'expense',
    amount: Math.abs(diff),
    category: 'ปรับยอดบัญชี',
    walletId,
    date: new Date().toISOString().split('T')[0],
    note: 'ปรับยอดให้ตรงกับธนาคารอัตโนมัติ'
  });
  document.getElementById('rec-actual').value = '';
  document.getElementById('rec-result').classList.add('hidden');
  postToSheets('reconcileWallet', { walletId, actualBalance, diff });
}

// --- 5. Rendering UI ---
function renderAll() {
  renderDashboard();
  renderTransactions();
  renderSplits();
  renderGoalsAndBudgets();
}

function renderDashboard() {
  const totalBal = state.wallets.reduce((sum, w) => sum + Number(w.balance), 0);
  document.getElementById('total-balance').textContent = '฿' + totalBal.toLocaleString('th-TH', { minimumFractionDigits: 2 });

  const curMonth = new Date().toISOString().slice(0, 7);
  const monthTxs = state.transactions.filter(t => String(t.date).startsWith(curMonth));
  const income = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  document.getElementById('month-income').textContent = '+฿' + income.toLocaleString();
  document.getElementById('month-expense').textContent = '-฿' + expense.toLocaleString();

  // Wallets
  document.getElementById('wallets-container').innerHTML = state.wallets.map(w => `
    <div class="min-w-[170px] p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
      <div class="w-3 h-3 rounded-full mb-2" style="background:${w.color || '#10B981'}"></div>
      <p class="text-xs text-slate-400 truncate">${w.name}</p>
      <p class="font-bold text-base mt-0.5">฿${Number(w.balance).toLocaleString()}</p>
    </div>
  `).join('');

  // Expense Chart
  const catTotals = {};
  monthTxs.filter(t => t.type === 'expense').forEach(t => {
    catTotals[t.category] = (catTotals[t.category] || 0) + Number(t.amount);
  });

  const ctx = document.getElementById('expenseChart');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(catTotals).length ? Object.keys(catTotals) : ['ยังไม่มีรายจ่าย'],
      datasets: [{
        data: Object.values(catTotals).length ? Object.values(catTotals) : [1],
        backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B'],
        borderWidth: 0
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
  });

  // Budget Bars
  const budgetHtml = state.budgets.map(b => {
    const spent = catTotals[b.category] || 0;
    const pct = Math.min(100, Math.round((spent / b.limitAmount) * 100));
    const barColor = pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
    return `
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span>${b.category}</span>
          <span>฿${spent.toLocaleString()} / ฿${Number(b.limitAmount).toLocaleString()} (${pct}%)</span>
        </div>
        <div class="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full ${barColor}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
  document.getElementById('dashboard-budgets').innerHTML = budgetHtml || '<p class="text-slate-400 text-xs">ยังไม่ได้ตั้งงบประมาณรายเดือน</p>';
}

function renderTransactions() {
  const q = document.getElementById('filter-search').value.toLowerCase();
  const cat = document.getElementById('filter-category').value;
  const mon = document.getElementById('filter-month').value;

  const filtered = state.transactions.filter(t => {
    const matchQ = !q || (t.note && t.note.toLowerCase().includes(q)) || t.category.toLowerCase().includes(q);
    const matchCat = !cat || t.category === cat;
    const matchMon = !mon || String(t.date).startsWith(mon);
    return matchQ && matchCat && matchMon;
  });

  document.getElementById('tx-list').innerHTML = filtered.map(t => {
    const wName = (state.wallets.find(w => w.id === t.walletId) || {}).name || '';
    const isInc = t.type === 'income';
    return `
      <div class="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div>
          <p class="font-semibold text-sm">${t.category} <span class="text-xs font-normal text-slate-400">• ${wName}</span></p>
          <p class="text-xs text-slate-400">${String(t.date).slice(0, 10)} ${t.note ? '— ' + t.note : ''}</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="font-bold ${isInc ? 'text-emerald-500' : 'text-rose-500'}">${isInc ? '+' : '-'}฿${Number(t.amount).toLocaleString()}</span>
          <button onclick="deleteTransaction('${t.id}')" class="text-slate-300 hover:text-rose-500 text-sm">🗑️</button>
        </div>
      </div>`;
  }).join('') || '<p class="text-center text-slate-400 py-8 text-sm">ไม่พบรายการที่ค้นหา</p>';
}

function renderSplits() {
  document.getElementById('split-list').innerHTML = state.splits.map(s => `
    <div class="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
      <div class="flex justify-between items-start">
        <div>
          <h4 class="font-bold">${s.title}</h4>
          <p class="text-xs text-slate-400">ยอดรวม ฿${Number(s.totalAmount).toLocaleString()} • ${String(s.date).slice(0, 10)}</p>
        </div>
        <span class="text-xs px-2.5 py-1 rounded-full ${s.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
          ${s.status === 'completed' ? 'ครบแล้ว' : 'รอโอนคืน'}
        </span>
      </div>
      <div class="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        ${s.members.map((m, idx) => `
          <div onclick="toggleSplitMemberPaid('${s.id}', ${idx})" class="flex justify-between items-center p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
            <span class="text-sm ${m.paid ? 'line-through text-slate-400' : ''}">${m.name}</span>
            <span class="text-xs font-semibold ${m.paid ? 'text-emerald-500' : 'text-amber-500'}">
              ฿${Number(m.amount).toLocaleString()} ${m.paid ? '✅ จ่ายแล้ว' : '⏳ รอจ่าย'}
            </span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('') || '<p class="text-slate-400 text-sm">ยังไม่มีรายการหารบิล กด "+ สร้างบิลหาร" ด้านบนได้เลย</p>';
}

function renderGoalsAndBudgets() {
  document.getElementById('goals-list').innerHTML = state.goals.map(g => {
    const pct = Math.min(100, Math.round((Number(g.currentAmount) / Number(g.targetAmount)) * 100));
    return `
      <div class="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
        <div class="flex justify-between items-center">
          <h4 class="font-bold">${g.title}</h4>
          <button onclick="depositToGoal('${g.id}')" class="text-xs px-3 py-1.5 rounded-lg bg-emerald-500 text-white font-medium">+ ออมเพิ่ม</button>
        </div>
        <div class="flex justify-between text-xs text-slate-400">
          <span>ออมได้ ฿${Number(g.currentAmount).toLocaleString()} / ฿${Number(g.targetAmount).toLocaleString()}</span>
          <span class="font-bold text-emerald-500">${pct}%</span>
        </div>
        <div class="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full bg-emerald-500" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('') || '<p class="text-slate-400 text-sm">ยังไม่มีเป้าหมายออมเงิน</p>';

  document.getElementById('budgets-list').innerHTML = state.budgets.map(b => `
    <div class="flex justify-between items-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-sm">
      <span>${b.category}</span>
      <span class="font-semibold">฿${Number(b.limitAmount).toLocaleString()} / เดือน</span>
    </div>
  `).join('');
}

// --- 6. Utilities ---
function populateDropdowns() {
  updateCategoryOptions();
  const walletOptions = state.wallets.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  document.getElementById('tx-wallet').innerHTML = walletOptions;
  document.getElementById('rec-wallet').innerHTML = walletOptions;

  const allCats = [...CATEGORIES.expense, ...CATEGORIES.income];
  document.getElementById('filter-category').innerHTML = '<option value="">ทุกหมวดหมู่</option>' + allCats.map(c => `<option value="${c}">${c}</option>`).join('');
  document.getElementById('budget-category').innerHTML = CATEGORIES.expense.map(c => `<option value="${c}">${c}</option>`).join('');
}

function updateCategoryOptions() {
  const type = document.querySelector('input[name="tx-type"]:checked').value;
  document.getElementById('tx-category').innerHTML = CATEGORIES[type].map(c => `<option value="${c}">${c}</option>`).join('');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.className = btn.dataset.tab === tabName
      ? 'nav-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-left bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
      : 'nav-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-left text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800';
  });

  document.querySelectorAll('.mob-nav-btn').forEach(btn => {
    btn.className = btn.dataset.tab === tabName
      ? 'mob-nav-btn flex flex-col items-center text-emerald-600 font-semibold'
      : 'mob-nav-btn flex flex-col items-center text-slate-400';
  });

  const titles = { dashboard: 'แดชบอร์ดภาพรวม', transactions: 'รายรับ-รายจ่าย', splits: 'หารบิลกับเพื่อน', goals: 'ออมเงิน & งบประมาณ', settings: 'เช็กยอดธนาคาร & ตั้งค่า' };
  document.getElementById('page-title').textContent = titles[tabName];
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); document.getElementById(id).classList.add('flex'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); document.getElementById(id).classList.remove('flex'); }

function toggleDarkMode() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('finmate_theme', isDark ? 'dark' : 'light');
}

function saveGasUrl() {
  state.gasUrl = document.getElementById('gas-url-input').value.trim();
  localStorage.setItem('finmate_gas_url', state.gasUrl);
  syncData(true);
}

function exportBackupJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `finmate-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}