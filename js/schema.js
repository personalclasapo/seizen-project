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

function formatEstimatedAmount(v) {
  if (!v) return '';
  const n = Number(v);
  if (isNaN(n) || n === 0) return '';
  const abs = Math.abs(n);
  let s;
  if (abs >= 100000000) {
    const oku = Math.round(abs / 10000000) / 10;
    s = oku.toLocaleString() + '億円';
  } else {
    s = abs.toLocaleString() + '円';
  }
  return n < 0 ? '− ' + s : s;
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
    holders: r => r.contract_holder_id ? [{ role: '契約者', name: r.contract_holder_id }] : [],
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
    headerTag: r => r.service_category || '',
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
      'account_number', 'estimated_amount', 'account_holder_id',
      'account_status', 'net_banking_usage'
    ],
    formFields: [
      { key: 'bank_name',          label: '銀行名',   type: 'text', required: true },
      { key: 'branch_name',        label: '支店名',   type: 'text' },
      { key: 'account_type',       label: '口座種別', type: 'select', options: ['普通預金','定期預金','貯蓄預金'] },
      { key: 'account_number',     label: '口座番号（任意）', type: 'text' },
      { key: 'estimated_amount',   label: '概算残高（円）', type: 'number' },
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
    holders: r => r.account_holder_id ? [{ role: '名義人', name: r.account_holder_id }] : [],
    estimatedAmount: r => formatEstimatedAmount(r.estimated_amount),
    subType: r => r.account_type || '',
    sub: r => [r.account_type, r.account_holder_id ? `名義：${r.account_holder_id}` : ''].filter(Boolean).join(' · '),
    infoCards: r => {
      const cards = [];
      if (r.estimated_amount) cards.push({
        label: '概算残高', type: 'amount',
        amountNum: Number(r.estimated_amount).toLocaleString()
      });
      return cards.concat([
        { label: '名義人',         value: r.account_holder_id },
        { label: '口座種別',       value: r.account_type },
        { label: '状態',           value: r.account_status },
        { label: 'ネットバンキング', value: r.net_banking_usage },
      ].filter(c => c.value));
    }
  },
  insurance: {
    label: '保険商品',
    group: '資産・負債',
    idPrefix: 'ins',
    cols: [
      'insurance_company', 'product_name', 'insurance_type',
      'policy_number', 'contract_holder_id', 'insured_person_id',
      'beneficiary_id', 'insurance_amount', 'estimated_amount',
      'payment_status', 'maturity_date', 'account_status'
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
      { key: 'estimated_amount',   label: '保険金額（円）', type: 'number' },
      { key: 'payment_status',     label: '払込状況', type: 'select', options: ['払込中','払込済','失効'] },
      { key: 'maturity_date',      label: '満期日（例：終身、2030年3月）', type: 'text' },
      { key: 'account_status',     label: 'ステータス', type: 'select', options: ['継続中','解約予定','解約済','失効'] },
    ],
    name: r => [r.insurance_company, r.product_name].filter(Boolean).join(' ') || '（名称未設定）',
    headerTag: r => r.maturity_date || '',
    statusTag: r => {
      const s = r.account_status;
      if (!s || s === '継続中') return null;
      if (s === '解約予定') return { label: s, bg: 'bg-amber-100', text: 'text-amber-700', norm: 'closing', muted: false };
      return { label: s, bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
    },
    holders: r => [
      { role: '契約者',   name: r.contract_holder_id },
      { role: '被保険者', name: r.insured_person_id },
      { role: '受取人',   name: r.beneficiary_id },
    ].filter(x => x.name),
    estimatedAmount: r => formatEstimatedAmount(r.estimated_amount),
    subType: r => r.insurance_type ? r.insurance_type + '保険' : '',
    sub: r => [r.insurance_type, r.contract_holder_id ? `契約者：${r.contract_holder_id}` : ''].filter(Boolean).join(' · '),
    infoCards: r => {
      const cards = [];
      if (r.estimated_amount) cards.push({
        label: '保険金額', type: 'amount',
        amountNum: Number(r.estimated_amount).toLocaleString()
      });
      return cards.concat([
        { label: '保険種別', value: r.insurance_type },
        { label: '契約者',   value: r.contract_holder_id },
        { label: '被保険者', value: r.insured_person_id },
        { label: '受取人',   value: r.beneficiary_id },
        { label: '払込状況', value: r.payment_status },
      ].filter(c => c.value));
    }
  },
  securities: {
    label: '証券・投資',
    group: '資産・負債',
    idPrefix: 'sec',
    cols: [
      'company_name', 'account_type', 'account_number',
      'holder_id', 'estimated_amount', 'net_usage', 'account_status'
    ],
    formFields: [
      { key: 'company_name',     label: '証券会社名',         type: 'text', required: true },
      { key: 'account_type',     label: '口座区分', type: 'select',
        options: ['特定','一般','NISA','つみたてNISA','iDeCo','その他'] },
      { key: 'account_number',   label: '口座番号（任意）',   type: 'text' },
      { key: 'holder_id',        label: '名義人',             type: 'family_select' },
      { key: 'estimated_amount', label: '評価額・概算（円）', type: 'number' },
      { key: 'net_usage',        label: 'ネット証券', type: 'select', options: ['利用中','登録のみ','未利用'] },
      { key: 'account_status',   label: 'ステータス', type: 'select', options: ['運用中','解約予定','解約済'] },
    ],
    name: r => [r.company_name, r.account_type].filter(Boolean).join(' ') || '（名称未設定）',
    headerTag: r => r.account_type || '',
    statusTag: r => {
      const s = r.account_status;
      if (!s || s === '運用中') return null;
      if (s === '解約予定') return { label: s, bg: 'bg-amber-100', text: 'text-amber-700', norm: 'closing', muted: false };
      return { label: s, bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
    },
    holders: r => r.holder_id ? [{ role: '名義人', name: r.holder_id }] : [],
    estimatedAmount: r => formatEstimatedAmount(r.estimated_amount),
    subType: r => r.account_type || '',
    sub: r => [r.account_type, r.holder_id ? `名義：${r.holder_id}` : ''].filter(Boolean).join(' · '),
    infoCards: r => {
      const cards = [];
      if (r.estimated_amount) cards.push({ label: '評価額', type: 'amount', amountNum: Number(r.estimated_amount).toLocaleString() });
      return cards.concat([
        { label: '口座区分',   value: r.account_type },
        { label: '名義人',     value: r.holder_id },
        { label: 'ネット証券', value: r.net_usage },
        { label: 'ステータス', value: r.account_status },
      ].filter(c => c.value));
    }
  },
  crypto: {
    label: '暗号資産',
    group: '資産・負債',
    idPrefix: 'crypto',
    cols: [
      'exchange_name', 'storage_type', 'coin_type',
      'holder_id', 'estimated_amount', 'seed_backup_status', 'account_status'
    ],
    formFields: [
      { key: 'exchange_name',      label: '取引所・ウォレット名', type: 'text', required: true },
      { key: 'storage_type',       label: '保管形態', type: 'select',
        options: ['取引所','ホットウォレット','ハードウェアウォレット','その他'] },
      { key: 'coin_type',          label: '通貨', type: 'select', options: ['BTC','ETH','その他'] },
      { key: 'holder_id',          label: '名義人',             type: 'family_select' },
      { key: 'estimated_amount',   label: '評価額・概算（円）', type: 'number' },
      { key: 'seed_backup_status', label: 'シードフレーズ・秘密鍵バックアップ', type: 'select',
        options: ['有（保管済）','無','確認中'] },
      { key: 'account_status',     label: 'ステータス', type: 'select', options: ['保有中','売却予定','売却済'] },
    ],
    name: r => r.exchange_name || '（名称未設定）',
    headerTag: r => r.coin_type || '',
    statusTag: r => {
      const s = r.account_status;
      if (!s || s === '保有中') return null;
      if (s === '売却予定') return { label: s, bg: 'bg-amber-100', text: 'text-amber-700', norm: 'closing', muted: false };
      return { label: s, bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
    },
    holders: r => r.holder_id ? [{ role: '名義人', name: r.holder_id }] : [],
    estimatedAmount: r => formatEstimatedAmount(r.estimated_amount),
    subType: r => r.storage_type || '',
    sub: r => [r.coin_type, r.holder_id ? `名義：${r.holder_id}` : ''].filter(Boolean).join(' · '),
    infoCards: r => {
      const cards = [];
      if (r.estimated_amount) cards.push({ label: '評価額', type: 'amount', amountNum: Number(r.estimated_amount).toLocaleString() });
      return cards.concat([
        { label: '保管形態',           value: r.storage_type },
        { label: '通貨',               value: r.coin_type },
        { label: '名義人',             value: r.holder_id },
        { label: 'バックアップ',       value: r.seed_backup_status },
        { label: 'ステータス',         value: r.account_status },
      ].filter(c => c.value));
    }
  },
  real_estate: {
    label: '不動産',
    group: '資産・負債',
    idPrefix: 're',
    cols: [
      'property_type', 'location', 'holder_id',
      'estimated_amount', 'loan_exists', 'usage_status'
    ],
    formFields: [
      { key: 'property_type',    label: '種別', type: 'select', options: ['土地','戸建','マンション','その他'] },
      { key: 'location',         label: '所在地（任意・ざっくりで可）', type: 'text' },
      { key: 'holder_id',        label: '名義人',             type: 'family_select' },
      { key: 'estimated_amount', label: '評価額・概算（円）', type: 'number' },
      { key: 'loan_exists',      label: 'ローン', type: 'select', options: ['あり','なし'] },
      { key: 'usage_status',     label: '利用状況', type: 'select', options: ['居住中','賃貸中','空き家','その他'] },
    ],
    name: r => [r.property_type, r.location].filter(Boolean).join(' ') || '（名称未設定）',
    headerTag: r => r.property_type || '',
    statusTag: r => {
      const s = r.usage_status;
      if (!s || s === '居住中') return null;
      if (s === '賃貸中') return { label: s, bg: 'bg-blue-50', text: 'text-blue-600', norm: 'active', muted: false };
      if (s === '空き家') return { label: s, bg: 'bg-amber-100', text: 'text-amber-700', norm: 'closing', muted: false };
      return { label: s, bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
    },
    holders: r => r.holder_id ? [{ role: '名義人', name: r.holder_id }] : [],
    estimatedAmount: r => formatEstimatedAmount(r.estimated_amount),
    subType: r => r.property_type || '',
    sub: r => [r.property_type, r.holder_id ? `名義：${r.holder_id}` : ''].filter(Boolean).join(' · '),
    infoCards: r => {
      const cards = [];
      if (r.estimated_amount) cards.push({ label: '評価額', type: 'amount', amountNum: Number(r.estimated_amount).toLocaleString() });
      return cards.concat([
        { label: '種別',       value: r.property_type },
        { label: '名義人',     value: r.holder_id },
        { label: 'ローン',     value: r.loan_exists },
        { label: '利用状況',   value: r.usage_status },
      ].filter(c => c.value));
    }
  },
  precious_metal: {
    label: '貴金属',
    group: '資産・負債',
    idPrefix: 'metal',
    cols: [
      'metal_type', 'holder_id', 'estimated_amount',
      'storage_location', 'custodian_name', 'account_status'
    ],
    formFields: [
      { key: 'metal_type',       label: '種別', type: 'select', options: ['金','プラチナ','銀','コイン','ジュエリー','その他'] },
      { key: 'holder_id',        label: '名義人',             type: 'family_select' },
      { key: 'estimated_amount', label: '評価額・概算（円）', type: 'number' },
      { key: 'storage_location', label: '保管場所', type: 'select', options: ['自宅金庫','貸金庫','業者保管','その他'] },
      { key: 'custodian_name',   label: '保管先名称（任意）', type: 'text' },
      { key: 'account_status',   label: 'ステータス', type: 'select', options: ['保管中','売却予定','売却済'] },
    ],
    name: r => [r.metal_type, r.custodian_name].filter(Boolean).join(' ') || '（名称未設定）',
    headerTag: r => r.metal_type || '',
    statusTag: r => {
      const s = r.account_status;
      if (!s || s === '保管中') return null;
      if (s === '売却予定') return { label: s, bg: 'bg-amber-100', text: 'text-amber-700', norm: 'closing', muted: false };
      return { label: s, bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
    },
    holders: r => r.holder_id ? [{ role: '名義人', name: r.holder_id }] : [],
    estimatedAmount: r => formatEstimatedAmount(r.estimated_amount),
    subType: r => r.metal_type || '',
    sub: r => [r.metal_type, r.holder_id ? `名義：${r.holder_id}` : ''].filter(Boolean).join(' · '),
    infoCards: r => {
      const cards = [];
      if (r.estimated_amount) cards.push({ label: '評価額', type: 'amount', amountNum: Number(r.estimated_amount).toLocaleString() });
      return cards.concat([
        { label: '種別',       value: r.metal_type },
        { label: '名義人',     value: r.holder_id },
        { label: '保管場所',   value: r.storage_location },
        { label: '保管先',     value: r.custodian_name },
        { label: 'ステータス', value: r.account_status },
      ].filter(c => c.value));
    }
  },
  loan: {
    label: '借入・保証',
    group: '資産・負債',
    idPrefix: 'loan',
    cols: [
      'lender_name', 'loan_type', 'debtor_id',
      'remaining_debt', 'repayment_due', 'account_status'
    ],
    formFields: [
      { key: 'lender_name',    label: '借入先・保証先',   type: 'text', required: true },
      { key: 'loan_type',      label: '種別', type: 'select',
        options: ['住宅ローン','自動車ローン','カードローン','事業性借入','連帯保証','その他'] },
      { key: 'debtor_id',      label: '債務者・保証人',   type: 'family_select' },
      { key: 'remaining_debt', label: '残債・概算（円）', type: 'number' },
      { key: 'repayment_due',  label: '完済予定（例：2035年3月）', type: 'text' },
      { key: 'account_status', label: 'ステータス', type: 'select', options: ['返済中','完済予定','完済','保証中'] },
    ],
    name: r => [r.lender_name, r.loan_type].filter(Boolean).join(' ') || '（名称未設定）',
    headerTag: r => r.loan_type || '',
    statusTag: r => {
      const s = r.account_status;
      if (!s || s === '返済中') return null;
      if (s === '完済予定') return { label: s, bg: 'bg-amber-100', text: 'text-amber-700', norm: 'closing', muted: false };
      if (s === '保証中') return { label: s, bg: 'bg-blue-50', text: 'text-blue-600', norm: 'active', muted: false };
      return { label: s, bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
    },
    holders: r => r.debtor_id ? [{ role: '債務者・保証人', name: r.debtor_id }] : [],
    estimatedAmount: r => r.remaining_debt ? formatEstimatedAmount(-Number(r.remaining_debt)) : '',
    subType: r => r.loan_type || '',
    sub: r => [r.loan_type, r.debtor_id ? `債務者：${r.debtor_id}` : ''].filter(Boolean).join(' · '),
    infoCards: r => {
      const cards = [];
      if (r.remaining_debt) cards.push({ label: '残債', type: 'amount', amountNum: Number(r.remaining_debt).toLocaleString() });
      return cards.concat([
        { label: '種別',         value: r.loan_type },
        { label: '債務者・保証人', value: r.debtor_id },
        { label: '完済予定',     value: r.repayment_due },
        { label: 'ステータス',   value: r.account_status },
      ].filter(c => c.value));
    }
  },
  contact_network: {
    label: '連絡網',
    group: 'もしもの時',
    noPerspectives: true,
    idPrefix: 'contact',
    cols: ['contact_name', 'relationship', 'notify_timing', 'phone_number', 'email', 'subject_id'],
    formFields: [
      { key: 'contact_name',  label: '氏名・名称', type: 'text' },
      { key: 'subject_id',    label: '対象者', type: 'family_select' },
      { key: 'relationship',  label: '関係',       type: 'text',
        placeholder: '例：父の高校の同級生、母の妹、菩提寺の住職' },
      { key: 'notify_timing', label: '連絡タイミング', type: 'select',
        options: ['危篤時に呼ぶ', '逝去後すぐ', '葬儀の案内', '後日通知でよい', '連絡不要'] },
      { key: 'phone_number',  label: '電話番号', type: 'text', placeholder: '例：090-1234-5678' },
      { key: 'email',         label: 'メールアドレス', type: 'text', placeholder: '例：taro@example.com' },
    ],
    name: r => r.contact_name || '（名称未設定）',
    statusTag: r => {
      if (r.notify_timing === '連絡不要')     return { label: '連絡不要', bg: 'bg-gray-100', text: 'text-gray-500', norm: 'closed', muted: true };
      if (r.notify_timing === '危篤時に呼ぶ') return { label: '危篤時',   bg: 'bg-rose-100', text: 'text-rose-700', norm: 'active', muted: false };
      if (!r.notify_timing)                   return null;
      return { label: r.notify_timing, bg: 'bg-blue-50', text: 'text-blue-600', norm: 'active', muted: false };
    },
    holders: r => r.subject_id ? [{ role: '対象者', name: r.subject_id }] : [],
    sub: r => r.relationship || '',
    subType: r => r.relationship || '',
    expandedExtras: r => [
      r.phone_number ? { label: '電話番号', value: r.phone_number } : null,
      r.email        ? { label: 'メール',   value: r.email }        : null,
    ].filter(Boolean),
    infoCards: r => [
      { label: '対象者',         value: r.subject_id },
      { label: '関係',           value: r.relationship },
      { label: '連絡タイミング', value: r.notify_timing },
      { label: '電話番号',       value: r.phone_number },
      { label: 'メールアドレス', value: r.email },
    ].filter(c => c.value),
  },
  medical_info: {
    label: '医療・身体',
    group: 'もしもの時',
    noPerspectives: true,
    idPrefix: 'med',
    cols: ['subject_id', 'medical_category', 'title'],
    formFields: [
      { key: 'title', label: '項目名', type: 'text', placeholderBy: 'medical_category' },
      { key: 'medical_category', label: '種別',   type: 'select',
        options: ['かかりつけ医・病院', '常用薬・お薬手帳', '持病・既往歴', '各種保険証',
                  '延命・治療の意思', '臓器提供の意思', '要介護・障害', 'その他'] },
      { key: 'subject_id',       label: '対象者', type: 'family_select' },
    ],
    name: r => r.title || r.medical_category || '（項目名未設定）',
    headerTag: r => r.medical_category || '',
    statusTag: r => null,
    holders: r => r.subject_id ? [{ role: '対象者', name: r.subject_id }] : [],
    sub: r => [r.subject_id, r.medical_category].filter(Boolean).join('・'),
    subType: r => '',
    infoCards: r => [
      { label: '対象者', value: r.subject_id },
      { label: '種別',   value: r.medical_category },
    ].filter(c => c.value),
  },
};

const GROUPS = [
  { label: '支出・収入',   sheets: ['cash_flow'] },
  { label: '資産・負債',   sheets: ['bank_account', 'insurance', 'securities', 'crypto', 'real_estate', 'precious_metal', 'loan'] },
  { label: 'もしもの時',   sheets: ['contact_network', 'medical_info'] },
  { label: 'のこすもの',   sheets: [] },
];

function getAllCols(sheetKey) {
  return [...COMMON_COLS, ...(SHEETS[sheetKey]?.cols || [])];
}

function doneCount(row, sheetKey) {
  const key = sheetKey || row._sheetKey;
  if (SHEETS[key]?.noPerspectives) {
    return row.q1_existence_status === '完了' ? 1 : 0;
  }
  return PERSPECTIVES.filter(p => row[p.statusCol] === '完了').length;
}

function perspectiveMax(sheetKey) {
  return SHEETS[sheetKey]?.noPerspectives ? 1 : PERSPECTIVES.length;
}

function perspectiveColor(status) {
  if (status === '完了')   return { bg: 'bg-green-50', text: 'text-green-700', icon: '✓' };
  if (status === '該当なし') return { bg: 'bg-gray-100', text: 'text-gray-400', icon: '—' };
  return { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: '△' };
}
