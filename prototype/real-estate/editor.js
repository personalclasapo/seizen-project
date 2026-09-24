/* この物件の確認・記録。入口が違っても state.js の同じ記録を編集する。 */
(function () {
  'use strict';
  /* 画面の文で対象の家族を呼ぶ続柄（既定「父」）。「本人」とは書かない
     ―― 操作するのは基本的に家族で、読み手が迷う（2026-09-24）。 */
  const WHO = (window.SeiZen && window.SeiZen.person && window.SeiZen.person.rel) || '父';
  const SPOUSE = (window.SeiZen && window.SeiZen.person && window.SeiZen.person.spouse) || '母';
  const S = window.SeiZenRealEstate;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const field = (name, label, value, wide, hint) => '<label class="re-field' + (wide ? ' wide' : '') + '"><span>' + esc(label) + '</span>' +
    (wide ? '<textarea rows="3" name="' + name + '">' + esc(value) + '</textarea>' : '<input name="' + name + '" value="' + esc(value) + '">') +
    (hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
  const select = (name, label, value, options) => '<label class="re-field"><span>' + esc(label) + '</span><select name="' + name + '">' +
    options.map(([v, text]) => '<option value="' + v + '"' + (value === v ? ' selected' : '') + '>' + esc(text) + '</option>').join('') + '</select></label>';
  /* 質問ひとつ＝問い＋選択肢を並べて見せる（前の代の相続登記で使う）。
     プルダウンにしない ―― 開くまで選択肢が見えず、長い選択肢は切れる。
     pill は短い選択肢を横に、row は説明の要る選択肢を縦に並べる。 */
  const choice = (name, value, options, kind, type) => '<div class="re-opts ' + (kind || 'pill') + '"' + (type === 'checkbox' ? '' : ' role="radiogroup"') + '>' +
    options.map(([v, label, sub, attr]) => '<label class="re-opt"' + (attr || '') + '><input type="' + (type || 'radio') + '" name="' + (type === 'checkbox' ? name + v : name) + '" value="' + (type === 'checkbox' ? 'on' : v) + '"' +
      ((type === 'checkbox' ? (value || []).includes(v) : v === value) ? ' checked' : '') + '><span><b>' + esc(label) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></label>').join('') + '</div>';
  const question = (title, body, hint, attr) => '<div class="re-q"' + (attr || '') + '><p class="re-q-t">' + title + '</p>' + body +
    (hint ? '<p class="re-q-h">' + esc(hint) + '</p>' : '') + '</div>';
  const section = (title, html, attr) => '<fieldset' + (attr || '') + '><legend>' + esc(title) + '</legend>' + html + '</fieldset>';
  const group = (title, html, note) => '<fieldset><legend>' + esc(title) + '</legend>' + (note ? '<p class="re-group-note">' + esc(note) + '</p>' : '') + '<div class="re-fields">' + html + '</div></fieldset>';
  const nextFields = v => group('残っている確認・対応', field('next', '次にすること', v.next, true, '分かったところまで保存できます。残る確認があれば書き留めてください。') + field('assignee', '確認する人', v.assignee) + field('timing', '確認する時期・きっかけ', v.timing));
  const findingOptions = [['unasked', 'まだ確認していない'], ['yes', 'ある'], ['no', 'ないと確認した'], ['unknown', '確認したが分からない']];
  const docOptions = [['unknown', '所在が分からない'], ['have', '所在が分かる'], ['lost', '探したが見つからない']];
  const known = [['unknown', '分からない'], ['yes', 'あり'], ['no', 'なし']];
  const titles = { boundary: '境界・越境の取り決め', road: '私道・通行・配管の取り決め', changed: '建物の変更・登記' };
  const questions = {
    boundary: '隣家と境界や塀について、話したこと・決めたことはありますか？',
    road: '通り道や配管について、誰と、どのような取り決めをしていますか？',
    changed: '増築や取り壊しなどをしたのは、いつ、どこに頼んだ工事ですか？'
  };
  /* 状態＝今のうちのバッジと同じ4つ。バッジを押して開いたポップアップの
     頭で選び直す。並びは 確認済み→対応が必要→未確認→該当なし。    */
  const STATUS_ORDER = ['done', 'action', 'unknown', 'none'];
  const statusField = cur => '<div class="re-status" role="radiogroup" aria-label="状態"><span class="re-status-lb">状態</span>' +
    STATUS_ORDER.map(k => '<label class="re-st-opt"><input type="radio" name="status" value="' + k + '"' +
      (k === cur ? ' checked' : '') + '><span class="bdg ' + S.NOW_STATUS[k].tone + '">' +
      esc(S.NOW_STATUS[k].label) + '</span></label>').join('') + '</div>';
  let dialog, opener, savedCallback, identity, initial;
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 're-dialog';
    dialog.setAttribute('aria-labelledby', 're-dialog-title');
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', e => { e.preventDefault(); closeRequest(); });
    dialog.addEventListener('close', () => {
      document.body.classList.remove('re-editing');
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    });
  }
  const formData = () => Object.fromEntries(new FormData(dialog.querySelector('form')));
  function closeRequest() {
    if (JSON.stringify(formData()) !== initial) {
      const prompt = dialog.querySelector('.re-discard');
      prompt.hidden = false;
      prompt.querySelector('button').focus();
    } else dialog.close();
  }
  function open(p, type, key, trigger, onSave) {
    ensureDialog();
    opener = trigger; savedCallback = onSave; identity = { id: p.id, type, key };
    let title = '', lead = '', body = '';
    if (type === 'matter') {
      const m = p.matters[key] || {}, d = m.detail || {}, doc = p.docs.at[key] || {};
      title = titles[key]; lead = questions[key];
      const cur = S.NOW_STATUS[m.uiStatus] ? m.uiStatus : S.matterProgress(p, key).status;
      body = statusField(cur) +
        group(WHO + 'への確認', select('interview', WHO + 'に聞けましたか', m.interview || 'unasked', [['unasked', 'まだ聞いていない'], ['heard', '聞けた'], ['unavailable', WHO + 'には確認できない']]) +
        select('find', key === 'changed' ? '建物の変更はありますか' : 'このような関係・取り決めはありますか', m.find || 'unasked', findingOptions) + field('source', '誰・何で確認しましたか', m.source, false, '例：' + WHO + 'に聞いた、工事資料で確認した')) +
        '<div data-matter-details>' + group('分かったことを残す',
          field('memo', '確認できた内容・これまでの経緯', m.memo, true) +
          field('who', key === 'changed' ? '工事の依頼先' : '関係する相手', d.who) +
          field('when', key === 'changed' ? '工事の時期' : '取り決めた時期', d.when) +
          select('resolution', key === 'changed' ? '登記・必要な手続きへの反映' : '取り決めについて残る確認・相談', m.resolution || (d.reg === '未対応' ? 'pending' : 'unknown'), key === 'changed'
            ? [['unknown', 'まだ確認できていない'], ['pending', '未対応・照会中'], ['resolved', '反映済み、または手続き不要と確認した']]
            : [['unknown', 'まだ確認できていない'], ['pending', '確認・相談が残っている'], ['resolved', '必要な確認・相談は済んでいる']])) +
          group('関係する書面', select('paper', '書面はありますか', d.paper || '不明', [['不明', '分からない'], ['あり', 'ある'], ['なし', 'ない']]) +
            '<div class="re-doc-fields wide">' + select('docSt', '書面の所在', doc.st || 'unknown', docOptions) + field('docPlace', '保管場所・取り出し方', doc.place, false, '「書類のありか」にも反映します。') + '</div>') + '</div>' + nextFields(m);
    } else if (type === 'prior') {
      /* 前の代の相続登記。答えは選ぶだけ（名前の欄を除く）。状態・次の
         対応・誰が・期限は SeiZen が答えから出すので、欄を置かない。 */
      const pr = p.priorInheritance || {};
      const keys = ['land', 'bldg'].filter(k => p.rights[k]);
      const nm = k => k === 'land' ? '土地' : p.kind === 'condo' ? '専有部分' : '建物';
      /* 前の代の名義人と、どれが前の代の名義かは、権利関係の名義と連動する
         （state.js の syncPriorToRights）。ここで選べば権利関係も変わる。 */
      title = '前の代の相続登記';
      /* 冒頭の説明文は置かない。なぜ要るかは行の一文が言い、次にすること・
         期限は行が出す。フォームは問いだけで足りる（2026-09-24）。 */
      lead = '';
      /* 1列で、問いの順に上から答える。答えに応じて要る問いだけを出す
         （conditionals）。選択肢は並べて見せる（choice）。
         名義を移す道は4つ（state.js の priorRoute）。道ごとに段階の選択肢が
         違うので、段階の問いは道の数だけ持ち、見えている1つを保存する。
         印鑑証明書は、協議書ができていて取得するのが当事者以外のときだけ
         聞く ―― 当事者の手続きが終わったかは、そこで決まる。             */
      const route = S.priorRoute(pr);
      const party = rel => rel === 'spouseParent' ? SPOUSE : rel === 'other' ? '家族側の相続人' : WHO;
      const stage = pr.stage === 'ready' ? 'signed' : pr.stage || 'none';
      const seal = pr.seal || (pr.stage === 'ready' ? 'given' : 'notyet');
      body = section('名義',
          question('土地・建物の登記に、前の代の名義が残っていますか',
            choice('remains', pr.remains || 'unknown', [['yes', '残っている'], ['no', '残っていない'], ['unknown', 'まだ確かめていない']]),
            '登記事項証明書で分かります。家族でも法務局で取得できます。') +
          (keys.length > 1 ? question('前の代の名義のもの', choice('parcel-', pr.parcels || [], keys.map(k => [k, nm(k)]), 'pill', 'checkbox'), '', ' data-prior-yes')
            : '<input type="hidden" name="parcel-' + keys[0] + '" value="on">') +
          question('前の代の名義人', '<input class="re-q-in" name="owner" value="' + esc(S.priorOwner(p)) + '" autocomplete="off">',
            '登記のとおりに。権利関係の「名義」にも反映します。', ' data-prior-yes') +
          question('名義人は、' + WHO + 'から見て', choice('rel', pr.rel || 'parent',
            [['parent', WHO + 'の親'], ['grand', WHO + 'の祖父母'], ['spouseParent', SPOUSE + 'の親'], ['other', 'その他']]), '', ' data-prior-yes')) +
        section('名義の移し方',
          question('名義を移す方法', choice('route', route, [
            ['split', '話し合いで決める', '相続人が複数いる'],
            ['will', '遺言がある', '遺言で、取得する人が決まっている'],
            ['sole', '相続人が1人だけ', '話し合いは要らない'],
            ['unknown', '分からない', '遺言の有無や、相続人をまだ確かめていない']], 'row')) +
          question('どこまで進んでいますか', choice('stage-split', route === 'split' ? stage : 'none', [
            ['none', '誰が取得するか、まだ話がついていない'],
            ['agreed', '取得する人は決まった', '協議書はまだない'],
            ['signed', '遺産分割協議書ができた', '相続人全員が署名・実印を押した'],
            ['registered', '相続登記まで済んだ']], 'row'), '', ' data-prior-route="split"') +
          question('どこまで進んでいますか', choice('stage-once', route !== 'split' && stage === 'registered' ? 'registered' : 'none',
            [['none', '登記はまだ'], ['registered', '相続登記まで済んだ']]), '', ' data-prior-route="will sole"') +
          question('<span data-taker-title>取得する人</span>', choice('taker', pr.taker === 'other' ? 'other' : 'self',
            [['self', party(pr.rel), '', ' data-taker-self'], ['other', 'ほかの相続人']]) +
            '<div class="re-q-sub" data-prior-other><input class="re-q-in" name="takerName" value="' + esc(pr.takerName) + '" placeholder="名前" autocomplete="off" aria-label="取得する人の名前"><p class="re-q-h">例：' + esc(WHO) + 'の弟 次郎</p></div>',
            '', ' data-prior-taker') +
          question('<span data-seal-title></span>', choice('seal', seal, [['given', '渡した'], ['notyet', 'まだ渡していない']]),
            '登記には、協議書と一緒に全員の印鑑証明書が要ります。亡くなった人の印鑑証明書は取れません。', ' data-prior-seal') +
          question('前の代が亡くなったのは', choice('died', pr.died || 'unknown',
            [['before', '2024年4月より前'], ['after', '2024年4月以降'], ['unknown', '分からない']]),
            '相続登記の期限が、これで決まります。'), ' data-prior-yes');
    } else if (type === 'right') {
      const r = p.rights[key] || {};
      title = (key === 'land' ? '土地' : p.kind === 'condo' ? '専有部分' : '建物') + 'の権利関係';
      lead = '登記などで確認した名義と、' + WHO + 'が知っている事情を残します。分からない部分は、そのまま保存できます。';
      body = group('名義・持分', field('owner', '確認した名義', r.owner) + select('hold', '権利の種類', r.hold || 'own', [['own', '所有'], ['share', '共有'], ['lease', '借地'], ['other', 'その他']]) + field('shares', '持分', r.shares) +
        select('match', '登記と認識している権利関係', r.match || 'unknown', [['unknown', '未確認・分からない'], ['same', '一致している'], ['differ', '違いがある']])) +
        group('確認', field('source', '確認した資料・相手', r.source) + field('memo', '経緯・話合い・相談の記録', r.memo, true)) + nextFields(r);
    } else if (type === 'loan') {
      const l = p.loan;
      title = 'ローンの記録'; lead = '借入先・契約者・団信の記録は、「そのとき」の案内にも反映します。';
      body = group('借入', select('has', '借入はありますか', l.has === true ? 'yes' : l.has === false ? 'no' : 'unknown', known) +
        '<div data-loan-details class="wide re-fields">' + field('bank', '借入先・窓口', l.bank) + field('tel', '窓口の電話番号', l.tel) + field('type', '借入の種類', l.type) + field('debtor', '契約者・債務者', l.debtor) +
        select('gteeStatus', '団信の加入', l.gteeStatus === 'none' ? 'unknown' : l.gteeStatus || 'unknown', known) + field('source', '確認した資料・相手', l.source) + '</div>' + field('memo', '契約について残しておくこと', l.memo, true));
    } else if (type === 'security') {
      const s = p.security || {};
      title = '担保の記録'; lead = WHO + 'の借入がなくても、この物件が他の人の借入の担保になっている場合があります。';
      body = group('この物件の担保', select('has', '担保になっていますか', s.has || 'unknown', known) +
        select('whose', '誰の借入ですか', s.whose || 'unknown', [['unknown', '分からない'], ['self', WHO], ['other', WHO + '以外']]) + field('what', '誰の・何の借入か', s.what) + field('bank', '借入先', s.bank) + field('order', '登記で確認した順位など', s.order));
    } else if (type === 'deal') {
      const d = p.deals[Number(key)] || {};
      title = key === 'new' ? '契約・関係を追加' : '契約・関係の記録'; lead = '管理を頼んでいる人や、貸し借りの相手との関係を、家族が引き継げるように残します。';
      body = group('相手と関係', select('kind', '関係の種類', d.kind || 'manage', [['manage', '管理を頼む'], ['lend', '貸す・使わせる'], ['borrow', '借りる']]) +
        field('who', '相手の名前・会社名', d.who) + field('tel', '連絡先', d.tel) + select('flow', 'お金のやり取り', d.flow || 'none', [['none', 'なし'], ['pay', '支払う'], ['recv', '受け取る']]) +
        field('what', '頼んでいること・契約や取り決め', d.what, true) + field('source', '確認した資料・相手', d.source)) + nextFields(d);
    } else if (type === 'doc') {
      const d = p.docs.at[key] || {};
      title = key === 'new' ? '別の書類の所在を記録' : S.DOC_KINDS[key].label;
      lead = '家族が実際に取り出せる場所や、預けている相手を残します。';
      body = group('書類のありか', (key === 'new' ? select('docKind', '書類の種類', 'build', Object.entries(S.DOC_KINDS).filter(([k]) => k !== 'prior' && k !== 'priorWill' && !p.docs.at[k]).map(([k,v]) => [k,v.label])) : '') + select('st', '書類の所在', d.st || 'unknown', docOptions) + field('place', '保管場所・取り出し方', d.place) + field('note', '探した場所・補足', d.note, true));
    }
    dialog.innerHTML = '<form><header class="re-dialog-head"><div><p class="re-eyebrow">' + esc(p.name) + ' ／ 確認と記録</p><h2 id="re-dialog-title" tabindex="-1">' + esc(title) + '</h2></div><button type="button" class="re-close" aria-label="閉じる">×</button></header>' +
      '<div class="re-dialog-body">' + (lead ? '<p class="re-lead">' + esc(lead) + '</p>' : '') + body + '</div>' +
      '<div class="re-discard" hidden><p>保存していない入力があります。</p><button type="button" data-keep>入力に戻る</button><button type="button" data-discard>変更を破棄して閉じる</button></div>' +
      '<footer class="re-dialog-foot"><p class="re-error" role="alert"></p><span>分かったところまで残せます</span><button type="button" data-cancel>キャンセル</button><button class="re-save" type="submit">記録を保存</button></footer></form>';
    dialog.querySelector('.re-close').onclick = closeRequest;
    dialog.querySelector('[data-cancel]').onclick = closeRequest;
    dialog.querySelector('[data-keep]').onclick = () => { dialog.querySelector('.re-discard').hidden = true; dialog.querySelector('input,select,textarea').focus(); };
    dialog.querySelector('[data-discard]').onclick = () => dialog.close();
    function conditionals() {
      const form = dialog.querySelector('form');
      const fields = dialog.querySelector('[data-matter-details]');
      if (fields) fields.hidden = form.elements.find.value === 'no';
      const docFields = dialog.querySelector('.re-doc-fields');
      if (docFields) docFields.hidden = form.elements.paper.value !== 'あり';
      const loanFields = dialog.querySelector('[data-loan-details]');
      if (loanFields) loanFields.hidden = form.elements.has.value === 'no';
      if (form.elements.remains) {
        const yes = form.elements.remains.value === 'yes';
        dialog.querySelectorAll('[data-prior-yes]').forEach(el => { el.hidden = !yes; });
        const route = form.elements.route.value, rel = form.elements.rel.value;
        const partyName = rel === 'spouseParent' ? SPOUSE : rel === 'other' ? '家族側の相続人' : WHO;
        dialog.querySelectorAll('[data-prior-route]').forEach(el => { el.hidden = !el.dataset.priorRoute.split(' ').includes(route); });
        /* 取得する人を聞くのは、決まっている段だけ（1人の道・分からない道では聞かない）。 */
        const splitStage = form.elements['stage-split'].value;
        const taker = route === 'will' || (route === 'split' && splitStage !== 'none');
        const other = taker && form.elements.taker.value === 'other';
        dialog.querySelector('[data-prior-taker]').hidden = !taker;
        dialog.querySelector('[data-prior-other]').hidden = !other;
        dialog.querySelector('[data-prior-seal]').hidden = !(route === 'split' && splitStage === 'signed' && other);
        dialog.querySelector('[data-taker-self] b').textContent = partyName;
        dialog.querySelector('[data-taker-title]').textContent = route === 'will' ? '遺言で取得する人' : '取得する人';
        dialog.querySelector('[data-seal-title]').textContent = partyName + 'の印鑑証明書を、' +
          (form.elements.takerName.value.trim() || '取得する人') + 'に渡しましたか';
      }
    }
    dialog.querySelector('form').onchange = conditionals;
    dialog.querySelector('form').oninput = e => { if (e.target.name === 'takerName') conditionals(); };
    conditionals();
    initial = JSON.stringify(formData());
    dialog.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const values = formData();
      if (identity.type === 'matter' && values.paper !== 'あり') { delete values.docSt; delete values.docPlace; }
      if (identity.type === 'prior') {
        values.parcels = ['land', 'bldg'].filter(k => values['parcel-' + k]);
        values.stage = values.route === 'split' ? values['stage-split'] : values.route === 'unknown' ? 'none' : values['stage-once'];
        if (values.route === 'split' && values.stage === 'none') values.taker = 'self';
        delete values['stage-split']; delete values['stage-once'];
      }
      const error = dialog.querySelector('.re-error');
      if (identity.type === 'prior' && values.remains === 'yes' && !values.parcels.length) { error.textContent = '前の代の名義のものを選んでください。'; return; }
      if (identity.type === 'deal' && !values.who.trim()) { error.textContent = '相手の名前・会社名を記録してください。'; return; }
      if (identity.type === 'matter' && values.find === 'no' && values.interview !== 'heard' && !values.source.trim()) { error.textContent = '該当しないことを確認した相手・資料を記録してください。'; return; }
      try { S.updateRecord(identity.id, identity.type, values.docKind || identity.key, values); }
      catch (e) { error.textContent = e.message; return; }
      dialog.close();
      savedCallback();
    };
    document.body.classList.add('re-editing');
    dialog.showModal();
    dialog.querySelector('h2').focus();
  }
  window.SeiZenRealEstateEditor = { open };
})();
