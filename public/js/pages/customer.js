import { api } from '../api.js';
import { h, clear, state, toast, dateTime, table } from '../ui.js';
import { periodPicker, statementCard } from './shared.js';

/** صفحة الزبون - كشف حسابه هو بس + إرسال ملاحظة/طلب */
export const CUSTOMER_NAV = [
  { key: 'statement', label: 'كشف حسابي', title: 'كشف حسابي', icon: 'statement', render: renderMyStatement },
  { key: 'requests', label: 'طلباتي', title: 'ملاحظة أو طلب', icon: 'message', render: renderMyRequests },
];

function renderMyStatement(root) {
  clear(root);
  const statementBox = h('div');
  let params = { week: 0 };
  const picker = periodPicker((p) => { params = p; loadStatement(); });
  root.append(picker, statementBox);

  async function loadStatement() {
    const data = await api.get(`/api/statements/${state.user.entity_id}`, params);
    clear(statementBox);
    statementBox.append(statementCard(data));
  }
  loadStatement();
}

function renderMyRequests(root) {
  clear(root);
  root.append(requestsCard());
}

function requestsCard() {
  const input = h('textarea', { rows: 3, placeholder: 'اكتب ملاحظتك أو طلبك لقصي…' });
  const listBox = h('div');

  const card = h('div', {},
    h('div.card.no-print', {},
    h('h3', {}, 'اكتب ملاحظة أو طلب'),
    h('div.grid', {},
      input,
      h('div.row', {}, h('button.btn', {
        onclick: async () => {
          const body = input.value.trim();
          if (!body) return toast('اكتب الملاحظة أول شي', true);
          await api.post('/api/requests', { body });
          input.value = '';
          toast('انبعت طلبك');
          loadRequests();
        },
      }, 'إرسال')))),
    h('div.card', {}, h('h3', {}, 'طلباتي السابقة'), listBox));

  async function loadRequests() {
    const { requests } = await api.get('/api/requests');
    clear(listBox);
    listBox.append(table([
      { label: 'الطلب', key: 'body' },
      { label: 'التاريخ', render: (r) => dateTime(r.created_at) },
      { label: 'الحالة', render: (r) => (r.handled ? h('span.pill.in', {}, 'تمّ') : h('span.pill.warn', {}, 'قيد المتابعة')) },
    ], requests, { empty: 'ما بعتت طلبات بعد' }));
  }
  loadRequests();
  return card;
}
