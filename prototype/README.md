# SeiZen プロトタイプ

素のHTML/CSS/JS。ビルドもフレームワークも入れていない。ファイルを
ブラウザで開けば動く（フォントの読み込みだけ外部）。

    prototype/index.html          ← ここから

## 構成

    index.html            整理対象の一覧（サイトの入口）
    preparing.html        まだ画面のない領域の共通ページ（?area=◯◯）
    shared/
      tokens.css          色と字。サイト全体でここだけが色を決める
      shell.css           左のガイドブック・作業面・意味説明・トースト
      site.css            index.html と preparing.html だけが使う
      areas.js            9領域の定義（名前・順番・アイコン・行き先）
      shell.js            ナビの描画、トースト、意味説明の開閉
    bank-account/         銀行口座（通帳）
    contract-digital/     契約・デジタル（索引＋詳細シート）
    assets/               画像

各領域は同じ3点セットを持つ。

    area.css   その領域の成果物UIの造形だけ
    state.js   その領域が扱う事実と語彙
    render.js  state を描き、書き戻す

## 守っている線

**外殻は共通、成果物UIは領域ごと。**

左のガイドブック・トークン・領域一覧は1か所にしかない。以前は2枚の
index.html へ同じものが写してあり、`.guide` `.menu-card` `.help` へ
上書きが5〜7重に積まれていた。ここへ戻さない。

いっぽう成果物UIは領域ごとに別物でよい。通帳（銀行口座）と索引
（契約・デジタル）は骨格が違う。正本§13のとおり、片方で作った形を
もう片方へ機械的に持ち出さない。

## 画面幅（3段）

ブレークポイントは `shared/tokens.css` の `--bp-wide` / `--bp-narrow`
（`@media` には数値直書き。値を変えるときは両方あわせる）。

    >1200px            固定幅の2カラム。左ガイドは常設。
    1200〜900px        流動2カラム。左ガイドは既定で畳み、ハンバーガー
                       （.appbar）で本文に被せて開く。開閉は localStorage
                       に記憶（seizen-guide-open）。
    ≤900px             1カラム。左ガイドはオフキャンバス・ドロワー
                       （スクリム付き・記憶なし）。

外殻の切り替えは `shared/shell.css` 末尾と `shell.js` の `wireDrawer`。
各領域の成果物UIは自分の `area.css` に `@media` を持ち、同じ2つの
境目（1200 / 900）に寄せる。

## 領域を1つ足すとき

1. `shared/areas.js` に1件足す（`status: 'soon'`）
2. 画面を作るなら `<領域id>/` を作り、`index.html` `area.css`
   `state.js` `render.js` を置いて `status: 'ready'` と `path` にする

ページ側で必要なのはこれだけ。

    <body data-area="領域id" data-root="../">
      <aside class="guide"></aside>   ← shell.js が中身を描く

## まだ入れていないもの

本番へ移すときに要るが、いま入れると触って確かめる速度が落ちるもの。

- ビルド・フレームワーク
- データの保存（`state.js` はリロードで消える。実在の口座番号や
  家族の情報をブラウザへ残す導線を、この段階では作らない）
- 認証・共有
- やること一覧（正本§4-3。補助領域なので導線を先に決めていない）
- 家族の切替（左下のプロフィールは押しても切り替わらない）
