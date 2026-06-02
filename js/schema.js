const COMMON_COLS = [
  'id', 'created_at', 'updated_at',
  'q1_existence_status', 'q1_existence_content',
  'q2_understanding_status', 'q2_understanding_content',
  'q3_access_status', 'q3_access_content',
  'q4_emergency_status', 'q4_emergency_content',
  'free_memo'
];

const PERSPECTIVES = [
  { key: 'q1', statusCol: 'q1_existence_status',   contentCol: 'q1_existence_content',   label: '存在の把握' },
  { key: 'q2', statusCol: 'q2_understanding_status', contentCol: 'q2_understanding_content', label: '中身の理解' },
  { key: 'q3', statusCol: 'q3_access_status',       contentCol: 'q3_access_content',      label: 'アクセス・操作' },
  { key: 'q4', statusCol: 'q4_emergency_status',    contentCol: 'q4_emergency_content',   label: '緊急時の手順' },
];

const STATUS_OPTIONS = ['完了', '未確認', '該当なし'];

const SHEETS = {
  cash_flow: {
    label: 'サブスク・支払い',
    group: '支出・収入',
    cols: [
      'service_name', 'service_category', 'cash_flow_type',
      'contract_holder_id', 'billing_cycle', 'billing_amount',
      'monthly_amount', 'payment_method', 'status',
      'input_source', 'source_transaction_id'
    ],
    name: r => r.service_name || '（名称未設定）',
    sub: r => {
      const parts = [];
      if (r.monthly_amount) parts.push(`月${Number(r.monthly_amount).toLocaleString()}円`);
      else if (r.billing_amount) parts.push(`${Number(r.billing_amount).toLocaleString()}円`);
      if (r.contract_holder_id) parts.push(`契約者：${r.contract_holder_id}`);
      return parts.join(' · ');
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
    sub: r => [r.account_type, r.account_holder_id ? `名義：${r.account_holder_id}` : ''].filter(Boolean).join(' · ')
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
    sub: r => [r.insurance_type, r.contract_holder_id ? `契約者：${r.contract_holder_id}` : ''].filter(Boolean).join(' · ')
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
