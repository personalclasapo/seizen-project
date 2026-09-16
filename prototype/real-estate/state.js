/* SeiZen プロトタイプ｜不動産・住まいの状態
   ------------------------------------------------------------------
   この領域で扱う事実を、表示から切り離してここに持つ。画面は
   この状態を描いた結果であって、状態の置き場所ではない。

   ■ この領域が成立させたいもの（正本 §13）

   不動産は、家族が「調べれば分かる」ものが比較的多い領域である。
   登記は法務局で取れるし、残債は金融機関に聞けば分かる。それでも
   SeiZen に載せる理由は、§13-1 の基準――**必要になったとき家族が
   思い出せない・調べられないことか**――に照らして次が残るから。

     ・どこに何があるか（物件そのものの所在・書類の所在）
     ・登記に出てこない事情（境界の口約束、越境、私道の負担、
       未登記の増築、名義と実態のずれ、親族間の取り決め）
     ・家族が物理的に入れるか（鍵・暗証番号・立ち会いの要否）

   とくに3つ目の「事情」は、本人が亡くなると調べる先が消える。
   相手方も高齢化し、口約束は記録に残らない。この領域の中心は
   資産評価ではなく、**この事情の受け渡し**にある。

   逆に載せないもの（§13-1）：
     ・固定資産税評価額・時価（継続更新しなければ正しくならない。
       古い額が「確認済み」の顔で残るほうが判断を誤らせる）
     ・登記簿に書いてある内容そのもの（所在が分かれば現物へ辿れる）
     ・間取り・設備の詳細（家族が見れば分かる）

   ■ 造形（正本 §4-2）

   物件ファイルではなく **間取り図**。理由は、この領域で家族が最初に
   知りたいのが「どの部屋に何の話があるか」ではなく「この家が今
   どういう状態で、誰の手が入っているか」だから。間取り図は、
   権利・ローン・事情という抽象を、家という一つの物の上に並べて
   見せられる唯一の器である。部屋の広さは項目の内容量に対応させ、
   壁・開口・建具は実寸比（外壁150mm・内壁100mm・室内ドア780mm）
   から引く。詳細は render.js の PLAN を参照。

   挙動確認のあいだ手が消えないよう localStorage に仮保存する。
   初期の仮データに戻したいときは、コンソールで
   localStorage.removeItem('SeiZenRealEstate.props') を実行する。  */
(function (global) {
  'use strict';

  const STORE_KEY = 'SeiZenRealEstate.props';
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(props)); } catch (e) { /* 無視 */ }
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ── 語彙 ─────────────────────────────────────────── */

  /* 状態（正本 §11）。「空欄」と「該当なし」を分ける。
     この領域では「調べれば分かるが、まだ調べていない」と
     「本人しか知らないことを聞けていない」が決定的に違う。
     前者は家族が後からでも取り返せるが、後者は取り返せない。 */
  const ST = {
    done:    { label: '確認済み',   tone: 'gr', sym: '○',
               about: '本人に確認して、記録に残した状態です。' },
    doing:   { label: '確認中',     tone: 'or', sym: '△',
               about: '調べている・問い合わせている途中です。' },
    todo:    { label: '未確認',     tone: 'or', sym: '△',
               about: 'まだ確認していません。本人に聞けるうちに。' },
    action:  { label: '対応が必要', tone: 'or', sym: '!',
               about: '確認の結果、手続きや相談が要ると分かった状態です。' },
    none:    { label: '該当なし',   tone: 'gy', sym: '—',
               about: 'この物件には当てはまりません。空欄とは違います。' },
    recheck: { label: '要再確認',   tone: 'bl', sym: '↻',
               about: '条件が変わったら確認しなおす必要があります。' }
  };

  /* 「本人しか知らない度」。§13-1 の基準を状態と別の軸で持つ。
     家族が後から調べられるものと、本人が失われると消えるものを
     画面で区別するため。進捗（§12）はこちらを重く数える。      */
  const REACH = {
    onlyself: { label: '本人しか知らない', tone: 'or',
                about: '本人に聞けなくなると、調べる先がありません。' },
    askable:  { label: '相手に聞ける',     tone: 'bl',
                about: '金融機関・管理会社など、聞ける先があります。' },
    public:   { label: '公的に調べられる', tone: 'gy',
                about: '登記・役所で取得できます。急ぎではありません。' }
  };

  /* 物件の種別。家族の動き方が実質的に変わる分け方だけを持つ
     （分類学ではない。正本 §3）。
       house  戸建て … 土地と建物が別の権利。境界・越境が起きる
       condo  マンション … 敷地は共有持分。管理組合が相手に出る
       land   土地のみ … 建物が無い。境界と利用の取り決めが中心
       other  その他 … 収益物件・別荘・共有の山林など           */
  const KINDS = {
    house: { label: '戸建て',     icon: 'house' },
    condo: { label: 'マンション', icon: 'condo' },
    land:  { label: '土地',       icon: 'land'  },
    other: { label: 'その他',     icon: 'other' }
  };

  /* 利用状況。家族が次に取る行動が変わる分け方。 */
  const USES = {
    self:   { label: '本人が住んでいる', tone: 'gr' },
    family: { label: '家族が住んでいる', tone: 'gr' },
    rent:   { label: '貸している',       tone: 'bl' },
    empty:  { label: '空き家',           tone: 'or' },
    unused: { label: '使っていない土地', tone: 'or' }
  };

  /* 「後から分かりにくい事情」の型。正本 §9（外部知識は SeiZen 側が
     持つ）に従い、何を確認すべきかの問いはここが持つ。利用者は
     問いに答えるだけでよく、論点を自分で思いつく必要がない。    */
  const MATTERS = {
    boundary: {
      label: '境界', icon: 'bound',
      ask: '隣地との境界は確定していますか。境界標はありますか。',
      why: '確定していないと、売却・建て替えのときに隣家との協議から' +
           '始めることになります。当事者が健在なうちに聞けているかが' +
           '効きます。' },
    encroach: {
      label: '越境', icon: 'cross',
      ask: '塀・樹木・庇・配管が、隣地との間で越えていませんか。',
      why: '越境は口約束で済ませていることが多く、代が変わると' +
           '「聞いていない」になります。' },
    road: {
      label: '私道', icon: 'road',
      ask: '前面道路は私道ですか。持分・通行・掘削の承諾はありますか。',
      why: '私道だと、水道・ガスの工事や再建築に承諾が要ります。' +
           '誰の承諾が要るかは本人しか知らないことが多い項目です。' },
    unreg: {
      label: '未登記', icon: 'unreg',
      ask: '登記されていない建物・増築部分はありませんか。',
      why: '未登記部分は売却・相続の手続きで必ず表に出ます。' },
    rebuilt: {
      label: '増改築', icon: 'build',
      ask: '増築・改築をしたことがありますか。確認申請は出しましたか。',
      why: '図面と現況が違うと、建て替え・売却時に是正を求められる' +
           'ことがあります。' },
    titled: {
      label: '名義に関する事情', icon: 'name',
      ask: '名義と実際の負担・出資が違っていませんか。相続未了の' +
           '名義はありませんか。',
      why: '「父名義のまま」は非常に多く、そのままでは売れません。' +
           '相続人が増えるほど難しくなるので、早いほど楽です。' },
    promise: {
      label: '親族・近隣との取り決め', icon: 'talk',
      ask: '書面にしていない約束はありませんか（通行・使用・費用負担）。',
      why: 'この領域でもっとも失われやすい情報です。本人が亡くなると' +
           '相手方の言い分しか残りません。' },
    other: {
      label: 'その他の特記事項', icon: 'note',
      ask: '家族が後から知って驚きそうなことは、ほかにありませんか。',
      why: '' }
  };

  /* 関わる相手との、お金のやり取りの向き。 */
  const FLOWS = {
    pay:  { label: '支払う',   tone: 'or' },
    recv: { label: '受け取る', tone: 'gr' },
    none: { label: 'なし',     tone: 'gy' }
  };

  /* ── 仮データ ─────────────────────────────────────── */

  const SEED = [
    {
      id: 'p1',
      /* 1. 基本情報 */
      name: '自宅', kind: 'house', use: 'self',
      addr: '神奈川県横浜市青葉区あざみ野1丁目12-34',
      built: '2004年', note: '',

      /* 2. 権利関係。土地と建物を別に持つ（戸建ての要点） */
      rights: {
        land:  { owner: '父（故人）名義のまま', shares: '', st: 'action',
                 reach: 'onlyself',
                 memo: '相続登記が済んでいない。兄弟3人が相続人。' },
        bldg:  { owner: '本人', shares: '単独', st: 'done', reach: 'public',
                 memo: '2004年6月に保存登記。' }
      },

      /* 3. この物件に関わる相手 */
      parties: [
        { name: '○○管理株式会社', role: '建物管理', flow: 'pay',
          what: '管理費・修繕積立金 月12,000円（毎月27日）',
          tel: '045-123-4567', st: 'done' },
        { name: '△△ガス株式会社', role: 'ガス供給（都市ガス）', flow: 'pay',
          what: 'ガス料金 月5,000〜8,000円', tel: '0570-000-123', st: 'done' }
      ],

      /* 4. ローン・担保 */
      loan: {
        has: true, bank: '○○銀行 青葉台支店', type: '住宅ローン',
        debtor: '本人単独', gtee: 'あり（団体信用生命保険）',
        mortgage: '第1順位・○○銀行', cross: 'なし',
        st: 'done', reach: 'askable',
        memo: '返済は2044年3月まで。残債は銀行に照会すれば分かる。'
      },

      /* 5. 後から分かりにくい事情 */
      matters: [
        { type: 'boundary', st: 'action', reach: 'onlyself',
          memo: '西側の境界は、隣家と口頭で「ブロック塀の中心」と' +
                '決めたまま。境界標なし。先方も高齢。' },
        { type: 'encroach', st: 'todo', reach: 'onlyself', memo: '' },
        { type: 'road',     st: 'none',  reach: 'public',
          memo: '前面道路は市道。' },
        { type: 'unreg',    st: 'action', reach: 'onlyself',
          memo: '北側の増築部分（約6畳）が未登記。1998年ごろ。' },
        { type: 'rebuilt',  st: 'doing', reach: 'onlyself',
          memo: '増築時の確認申請の有無を工務店に照会中。' },
        { type: 'titled',   st: 'action', reach: 'onlyself',
          memo: '土地が父名義のまま。上の「権利関係」と同じ話。' },
        { type: 'promise',  st: 'todo',  reach: 'onlyself', memo: '' },
        { type: 'other',    st: 'todo',  reach: 'onlyself', memo: '' }
      ],

      /* 6. 家族が入る方法 */
      access: {
        who: '長男', key: '長男が予備鍵を保管', keyKind: 'ディンプルキー',
        code: '玄関脇の門扉のみ暗証（家族は知っている）',
        how: '立ち会いは不要。管理会社への連絡も不要。',
        st: 'done', reach: 'onlyself'
      },

      /* 7. 関係書類 */
      docs: {
        place: '書斎のキャビネット上段',
        items: [
          { name: '登記識別情報（権利証）', where: '書斎のキャビネット上段', st: 'done' },
          { name: '売買契約書・重要事項説明書', where: '書斎のキャビネット上段', st: 'done' },
          { name: '住宅ローン契約書', where: '書斎のキャビネット上段', st: 'done' },
          { name: '確定測量図・境界確認書', where: '', st: 'action' },
          { name: '固定資産税の納税通知書', where: 'リビングの棚', st: 'done' }
        ],
        st: 'action'
      }
    },

    {
      id: 'p2',
      name: '実家', kind: 'house', use: 'empty',
      addr: '新潟県長岡市○○町2-5-1',
      built: '1971年', note: '母が施設に入ってから空き家。',
      rights: {
        land: { owner: '母', shares: '単独', st: 'done', reach: 'public', memo: '' },
        bldg: { owner: '母', shares: '単独', st: 'done', reach: 'public', memo: '' }
      },
      parties: [
        { name: '近所の□□さん', role: '見回り・郵便物の確認', flow: 'none',
          what: '月1回ほど様子を見てもらっている', tel: '0258-00-0000', st: 'doing' }
      ],
      loan: { has: false, st: 'none', reach: 'public', memo: '完済済み。' },
      matters: [
        { type: 'boundary', st: 'todo', reach: 'onlyself', memo: '' },
        { type: 'road', st: 'action', reach: 'onlyself',
          memo: '前面が私道。持分の有無が不明。近隣3軒との共有かもしれない。' },
        { type: 'promise', st: 'todo', reach: 'onlyself',
          memo: '' }
      ],
      access: {
        who: '', key: '', keyKind: '', code: '', how: '',
        st: 'todo', reach: 'onlyself'
      },
      docs: { place: '', items: [], st: 'todo' }
    }
  ];

  let props = loadSaved() || JSON.parse(JSON.stringify(SEED));

  /* ── 進捗（正本 §12）──────────────────────────────
     入力率ではなく「必要な状態がどこまで成立しているか」。
     成立とは、家族が動けること。なので数えるのは欄の数ではなく、
     §13-1 で「本人しか知らない」とした事実が受け渡されたか。

     重みづけ：onlyself を 3、askable を 1、public を 0 で数える。
     public（登記で取れるもの）を未確認のまま残しても、家族は
     困らない。困るのは onlyself が空のまま本人が失われること。  */
  const W = { onlyself: 3, askable: 1, public: 0 };

  function gauge(p) {
    let got = 0, need = 0, risk = [];
    const add = (st, reach, label) => {
      const w = W[reach || 'askable'];
      if (st === 'none') return;           /* 該当なしは分母に入れない */
      need += w;
      if (st === 'done') got += w;
      else if (w >= 3) risk.push(label);   /* 本人しか知らない×未確認 */
    };
    add(p.rights.land.st, p.rights.land.reach, '土地の権利関係');
    add(p.rights.bldg.st, p.rights.bldg.reach, '建物の権利関係');
    add(p.loan.st, p.loan.reach, 'ローン・担保');
    add(p.access.st, p.access.reach, '家族が入る方法');
    add(p.docs.st, 'onlyself', '書類のありか');
    (p.matters || []).forEach(m => add(m.st, m.reach, MATTERS[m.type].label));
    (p.parties || []).forEach(x => add(x.st, 'askable', x.name));
    return { got, need, risk, pct: need ? Math.round(got / need * 100) : 0 };
  }

  global.SeiZenRealEstate = {
    ST, REACH, KINDS, USES, MATTERS, FLOWS,
    all: () => props,
    find: id => props.filter(p => p.id === id)[0] || null,
    gauge,
    save
  };
})(window);
