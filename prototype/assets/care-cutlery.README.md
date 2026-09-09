# care-cutlery.svg — フォークとナイフ

介護領域「利用している介護・生活支援」の表で、行頭アイコン
**配食サービス**（皿＋カトラリー）に使う。

## 出どころ

Openclipart の
[Kitchen Icon - Knife Spoon Fork](https://openclipart.org/detail/169913/kitchen-icon-knife-spoon-fork)
から、`fork` と `knife` の2グループだけを取り出したもの。
viewBox は元のまま `0 0 276.285 286.559`（座標を触っていないので、
元データと突き合わせられる）。

**ライセンス：CC0（パブリックドメイン）。** 表示義務は無いが、
出どころを辿れるようにここに残す。

`spoon` グループは使わないので落とした。皿は `render.js` 側で円として
描き、その左右にフォークとナイフを置く。

## なぜ自前で描かないか

カトラリーは「それらしさに説得力が要る」側（CLAUDE.md の着手前判定）。
フォークの4本の歯の間隔と根元の合流、ナイフの刃の膨らみは、矩形と円で
は出ない。18px の行頭で「皿とカトラリー」に見えるかどうかは、この
輪郭の精度で決まる。

## なぜこの素材か（ほかを落とした理由）

- **グラデーションが0個・transform 無し・塗りは `#231F20` の単色**。
  SeiZen の視覚言語（単色フラット）にそのまま乗る。`fill` を
  `currentColor` に差し替えるだけで系統色が当たる。
- 同じ CC0 でも Wikimedia の `Broom_.svg` は黒い輪郭線＋木目グラデの
  絵で、小さくすると読めなかった（`care-board-motifs.RESEARCH.md`）。
- OpenMoji にも揃ったグリフはあるが **CC BY-SA 4.0**。このプロジェクトは
  CC0 のみで通す（2026-09-09 判断）。

## 使い方

`render.js` の `SV_GLYPH.meal` が、この2つのパスを皿の円と組んで
1つの `viewBox` に収める。`fill` は `currentColor`＝行の系統色。
