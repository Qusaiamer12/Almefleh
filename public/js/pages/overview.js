import { api } from '../api.js';
import { h, clear, dateTime, table } from '../ui.js';
import { renderStock, renderStatements, renderLoss, renderTransactions, renderVouchers } from './shared.js';

/** صفحة الاطّلاع (أبو بلال) - قراءة فقط لكل الأرقام */
export const OVERVIEW_NAV = [
  { key: 'stock', label: 'الستوك', title: 'الستوك اللحظي', icon: 'box', render: renderStock },
  { key: 'statements', label: 'كشوفات الزباين', title: 'كشوفات الزباين', icon: 'statement', render: renderStatements },
  { key: 'vouchers', label: 'السندات', title: 'سندات البضاعة', icon: 'voucher', render: (root) => renderVouchers(root) },
  { key: 'transactions', label: 'الحركات', title: 'سجل الحركات', icon: 'list', render: (root, ctx) => renderTransactions(root, { ctx }) },
  { key: 'loss', label: 'النقص والفاقد', title: 'النقص والفاقد', icon: 'loss', render: renderLoss },
  { key: 'requests', label: 'طلبات الزباين', title: 'طلبات وملاحظات الزباين', icon: 'message', render: renderRequests },
];

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
