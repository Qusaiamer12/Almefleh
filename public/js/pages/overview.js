import { api } from '../api.js';
import { h, clear, dateTime, table } from '../ui.js';
import { renderStock, renderStatements, renderLoss, renderTransactions } from './shared.js';

/** صفحة الاطّلاع (أبو بلال) - قراءة فقط لكل الأرقام */
const TABS = [
  { key: 'stock', label: 'الستوك', render: renderStock },
  { key: 'statements', label: 'كشوفات الزباين', render: renderStatements },
  { key: 'transactions', label: 'الحركات', render: (root) => renderTransactions(root) },
  { key: 'loss', label: 'النقص والفاقد', render: renderLoss },
  { key: 'requests', label: 'طلبات الزباين', render: renderRequests },
];

export function renderOverview(root) {
  clear(root);
  const tabsBar = h('div.tabs');
  const page = h('div.page');
  root.append(tabsBar, page);

  let active = 'stock';
  const draw = () => {
    clear(tabsBar);
    for (const tab of TABS) {
      tabsBar.append(h('button', {
        class: active === tab.key ? 'active' : '',
        onclick: () => { active = tab.key; draw(); },
      }, tab.label));
    }
    clear(page);
    page.append(h('div.empty', {}, 'جاري التحميل…'));
    Promise.resolve(TABS.find((t) => t.key === active).render(page))
      .catch((err) => { clear(page); page.append(h('div.alert.danger', {}, err.message)); });
  };
  draw();
}

async function renderRequests(root) {
  clear(root);
  const { requests } = await api.get('/api/requests');
  root.append(h('div.card', {},
    h('h3', {}, 'طلبات وملاحظات الزباين'),
    table([
      { label: 'الزبون', key: 'entity_name' },
      { label: 'الطلب', key: 'body' },
      { label: 'التاريخ', render: (r) => dateTime(r.created_at) },
      { label: 'الحالة', render: (r) => (r.handled ? h('span.pill.in', {}, 'تمّ') : h('span.pill.warn', {}, 'مفتوح')) },
    ], requests, { empty: 'ما في طلبات' })));
}
