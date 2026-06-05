const COMMON_COLS = [
  'id', 'created_at', 'updated_at',
  'q1_existence_status', 'q1_existence_content',
  'q2_understanding_status', 'q2_understanding_content',
  'q3_access_status', 'q3_access_content',
  'q4_emergency_status', 'q4_emergency_content',
  'free_memo'
];

const PERSPECTIVES = [
  { key: 'q2', statusCol: 'q2_understanding_status', contentCol: 'q2_understanding_content', label: '中身' },
  { key: 'q3', statusCol: 'q3_access_status',       contentCol: 'q3_access_content',      label: 'アクセス' },
  { key: 'q4', statusCol: 'q4_emergency_status',    contentCol: 'q4_emergency_content',   label: '緊急' },
];

const STATUS_OPTIONS = ['完了', '未確認', '該当なし'];

const HOLDER_COLORS = {
  '父':  { bg: 'bg-blue-100',  text: 'text-blue-700'  },
  '母':  { bg: 'bg-rose-100',  text: 'text-rose-700'  },
  '自分': { bg: 'bg-green-100', text: 'text-green-700' },
  '子':  { bg: 'bg-amber-100', text: 'text-amber-700' },
};

function holderColor(holder) {
  return HOLDER_COLORS[holder] || { bg: 'bg-gray-100', text: 'text-gray-500' };
}

const SHEETS = {
  cash_flow: {
    label: 'サブスク・支払い',
    group: '支出・収入',
    cols: [
      'service_name', 'service_category', 'cash_flow_type',
      'contract_holder_id', 'billing_cycle', 'billing_amount',
      'monthly_amount', 'payment_method', 'status',
      'input_source', 'source_transaction_id', 'plan'
    ],
    name: r => r.service_name || '（名称未設定）',
    statusTag: r => {
      const s = r.status;
      if (!s || s === '継続中') return null;
      if (s === '解約予定') return { label: s, bg: 'bg-amber-100', text: 'text-amber-700', norm: 'closing', muted: false };
      return { label: s, bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
    },
    sub: r => {
      const parts = [];
      if (r.monthly_amount) parts.push(`月${Number(r.monthly_amount).toLocaleString()}円`);
      else if (r.billing_amount) parts.push(`${Number(r.billing_amount).toLocaleString()}円`);
      if (r.contract_holder_id) parts.push(`契約者：${r.contract_holder_id}`);
      return parts.join(' · ');
    },
    amountNum: r => {
      const n = r.monthly_amount || r.billing_amount;
      return n ? Number(n).toLocaleString() : '';
    },
    amountCycle: r => {
      if (r.monthly_amount) return '月';
      if (r.billing_amount && r.billing_cycle) return r.billing_cycle;
      return '';
    },
    holder: r => r.contract_holder_id || '',
    plan: r => r.plan || '',
    infoCards: r => {
      const cards = [];
      const n = r.monthly_amount || r.billing_amount;
      if (n) cards.push({
        label: '金額', type: 'amount',
        amountNum: Number(n).toLocaleString(),
        amountCycle: r.billing_cycle === '月額' ? '月' : (r.billing_cycle || (r.monthly_amount ? '月' : ''))
      });
      if (r.plan) cards.push({ label: 'プラン', value: r.plan });
      if (r.contract_holder_id) cards.push({ label: '契約者', value: r.contract_holder_id });
      return cards;
    }
  },
  bank_account: {
    label: '銀行口座',
    group: '資産・負債',
    cols: [
      'bank_name', 'branch_name', 'account_type',
      'account_number', 'account_holder_id',
      'account_status', 'net_banking_usage'
    ],
    name: r => [r.bank_name, r.branch_name].filter(Boolean).join(' ') || '（名称未設定）',
    statusTag: r => {
      const s = r.account_status;
      if (!s || s === 'メイン') return null;
      if (s === '解約予定') return { label: s, bg: 'bg-amber-100', text: 'text-amber-700', norm: 'closing', muted: false };
      if (s === '休眠') return { label: s, bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
      if (s === 'サブ') return { label: s, bg: 'bg-blue-50', text: 'text-blue-600', norm: 'active', muted: false };
      return { label: s, bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
    },
    sub: r => [r.account_type, r.account_holder_id ? `名義：${r.account_holder_id}` : ''].filter(Boolean).join(' · '),
    infoCards: r => [
      { label: '名義人',         value: r.account_holder_id },
      { label: '口座種別',       value: r.account_type },
      { label: '状態',           value: r.account_status },
      { label: 'ネットバンキング', value: r.net_banking_usage },
    ].filter(c => c.value)
  },
  insurance: {
    label: '保険商品',
    group: '資産・負債',
    cols: [
      'insurance_company', 'product_name', 'insurance_type',
      'policy_number', 'contract_holder_id', 'insured_person_id',
      'beneficiary_id', 'insurance_amount', 'payment_status',
      'maturity_date', 'account_status'
    ],
    name: r => [r.insurance_company, r.product_name].filter(Boolean).join(' ') || '（名称未設定）',
    statusTag: r => {
      const s = r.account_status;
      if (!s || s === '継続中') return null;
      if (s === '解約予定') return { label: s, bg: 'bg-amber-100', text: 'text-amber-700', norm: 'closing', muted: false };
      return { label: s, bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
    },
    sub: r => [r.insurance_type, r.contract_holder_id ? `契約者：${r.contract_holder_id}` : ''].filter(Boolean).join(' · '),
    infoCards: r => [
      { label: '契約者',   value: r.contract_holder_id },
      { label: '被保険者', value: r.insured_person_id },
      { label: '受取人',   value: r.beneficiary_id },
      { label: '保険種別', value: r.insurance_type },
      { label: '払込状況', value: r.payment_status },
    ].filter(c => c.value)
  }
};

const GROUPS = [
  { label: '支出・収入',   sheets: ['cash_flow'] },
  { label: '資産・負債',   sheets: ['bank_account', 'insurance'] },
  { label: '健康・人間関係', sheets: [] },
  { label: '想い・希望',   sheets: [] },
];

function getAllCols(sheetKey) {
  return [...COMMON_COLS, ...(SHEETS[sheetKey]?.cols || [])];
}

function doneCount(row) {
  return PERSPECTIVES.filter(p => row[p.statusCol] === '完了').length;
}

function perspectiveColor(status) {
  if (status === '完了')   return { bg: 'bg-green-50', text: 'text-green-700', icon: '✓' };
  if (status === '該当なし') return { bg: 'bg-gray-100', text: 'text-gray-400', icon: '—' };
  return { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: '△' };
}
