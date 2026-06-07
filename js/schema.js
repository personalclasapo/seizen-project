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

const MEMBER_COLOR_PRESETS = {
  blue:   { bg: 'bg-blue-100',   text: 'text-blue-700'   },
  rose:   { bg: 'bg-rose-100',   text: 'text-rose-700'   },
  green:  { bg: 'bg-green-100',  text: 'text-green-700'  },
  amber:  { bg: 'bg-amber-100',  text: 'text-amber-700'  },
  purple: { bg: 'bg-purple-100', text: 'text-purple-700' },
  teal:   { bg: 'bg-teal-100',   text: 'text-teal-700'   },
  orange: { bg: 'bg-orange-100', text: 'text-orange-700' },
  indigo: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
};

let _memberColorMap = {};

function loadFamilyMembers(members) {
  _memberColorMap = {};
  for (const m of members) {
    if (m.display_name) {
      _memberColorMap[m.display_name] = MEMBER_COLOR_PRESETS[m.color] || { bg: 'bg-gray-100', text: 'text-gray-500' };
    }
  }
}

function holderColor(holder) {
  return _memberColorMap[holder] || { bg: 'bg-gray-100', text: 'text-gray-500' };
}

const CYCLE_SHORT = { '月額': '月', '年額': '年' };
function formatCycle(r) {
  const raw = r.billing_cycle;
  return CYCLE_SHORT[raw] ?? raw ?? (r.monthly_amount ? '月' : '');
}

const SHEETS = {
  cash_flow: {
    label: 'サブスク・支払い',
    group: '支出・収入',
    idPrefix: 'cash',
    cols: [
      'service_name', 'service_category', 'cash_flow_type',
      'contract_holder_id', 'billing_cycle', 'billing_amount',
      'monthly_amount', 'payment_method', 'status',
      'input_source', 'source_transaction_id', 'plan'
    ],
    formFields: [
      { key: 'service_name',      label: 'サービス名・業者名', type: 'text',   required: true },
      { key: 'service_category',  label: '種別',   type: 'select',
        options: ['サブスク','公共料金','通信','メディア(NHK・新聞)','保険料の支払い','月額会員費','駐車場・トランクルーム・貸金庫','ローン返済','年金','給与','家賃収入','その他'] },
      { key: 'cash_flow_type',    label: '支出/収入', type: 'select', options: ['支出','収入'] },
      { key: 'billing_cycle',     label: '請求サイクル', type: 'select', options: ['月額','年額','隔月','その他'] },
      { key: 'billing_amount',    label: '請求額（円）', type: 'number' },
      { key: 'payment_method',    label: '支払い方法・口座', type: 'text' },
      { key: 'contract_holder_id', label: '契約者', type: 'family_select' },
      { key: 'status',            label: 'ステータス', type: 'select', options: ['継続中','解約予定','解約済'] },
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
    amountCycle: r => formatCycle(r),
    holder: r => r.contract_holder_id || '',
    plan: r => r.plan || '',
    infoCards: r => {
      const cards = [];
      const n = r.monthly_amount || r.billing_amount;
      if (n) cards.push({
        label: '金額', type: 'amount',
        amountNum: Number(n).toLocaleString(),
        amountCycle: formatCycle(r)
      });
      if (r.plan) cards.push({ label: 'プラン', value: r.plan });
      if (r.contract_holder_id) cards.push({ label: '契約者', value: r.contract_holder_id });
      return cards;
    }
  },
  bank_account: {
    label: '銀行口座',
    group: '資産・負債',
    idPrefix: 'bank',
    cols: [
      'bank_name', 'branch_name', 'account_type',
      'account_number', 'account_holder_id',
      'account_status', 'net_banking_usage'
    ],
    formFields: [
      { key: 'bank_name',          label: '銀行名',   type: 'text', required: true },
      { key: 'branch_name',        label: '支店名',   type: 'text' },
      { key: 'account_type',       label: '口座種別', type: 'select', options: ['普通預金','定期預金','貯蓄預金'] },
      { key: 'account_number',     label: '口座番号（任意）', type: 'text' },
      { key: 'account_holder_id',  label: '名義人',   type: 'family_select' },
      { key: 'net_banking_usage',  label: 'ネットバンキング', type: 'select', options: ['利用中','登録のみ','未利用'] },
      { key: 'account_status',     label: 'ステータス', type: 'select', options: ['メイン','サブ','休眠','解約予定'] },
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
    idPrefix: 'ins',
    cols: [
      'insurance_company', 'product_name', 'insurance_type',
      'policy_number', 'contract_holder_id', 'insured_person_id',
      'beneficiary_id', 'insurance_amount', 'payment_status',
      'maturity_date', 'account_status'
    ],
    formFields: [
      { key: 'insurance_company',  label: '保険会社名',   type: 'text', required: true },
      { key: 'product_name',       label: '商品名',       type: 'text' },
      { key: 'insurance_type',     label: '種別', type: 'select',
        options: ['生命','医療','がん','個人年金','火災・地震','自動車','その他'] },
      { key: 'policy_number',      label: '証券番号',     type: 'text' },
      { key: 'contract_holder_id', label: '契約者',       type: 'family_select' },
      { key: 'insured_person_id',  label: '被保険者',     type: 'family_select' },
      { key: 'beneficiary_id',     label: '受取人',       type: 'family_select' },
      { key: 'insurance_amount',   label: '保険金額',     type: 'text' },
      { key: 'payment_status',     label: '払込状況', type: 'select', options: ['払込中','払込済','失効'] },
      { key: 'maturity_date',      label: '満期日（例：終身、2030年3月）', type: 'text' },
      { key: 'account_status',     label: 'ステータス', type: 'select', options: ['継続中','解約予定','解約済','失効'] },
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
