# 福祉用具のアイコン — 出どころ・ライセンス・採否

介護ゾーン「介護で使うもの」（`.eqshelf` の棚差し）に置く福祉用具の
グリフ。CLAUDE.md の振り分けで**「PD/CC0 素材を探すのが先」**の側と
判定し、探索してから実装した（2026-09-11）。

## なぜ差し替えたか

従来は自作の線画（`viewBox 24×24`、stroke ベース）だった。棚差しに
作り替えて 24→38px に拡大したところ、実画面で

- **介護ベッド → タブレット／スマホに見える**（真上図の矩形＋柵）
- **歩行器 → 鳥居に見える**（枠＋2本脚）

という状態だった（2026-09-10 のスクリーンショットで確認）。
CLAUDE.md の「これは何の絵か一言で言えるか」に答えられていない。

ユーザー指示（2026-09-11）：「アイコンがチープすぎるので、ちゃんとした
アイコンにして。これも数値で調整するんじゃなくて、ちゃんとどっかから
持ってきて。」

## 採用：Health Icons

- サイト：https://healthicons.org/
- リポジトリ：https://github.com/resolvetosavelives/healthicons
- **ライセンス：アイコン本体は CC0（パブリックドメイン）**

  README に明記：*"These icons are available in the public domain (CC0)
  for use in any type of project."*

  ★リポジトリの `LICENSE` は **MIT**（Copyright (c) 2021 Resolve to
  Save Lives）だが、これはサイト／ビルドコードに掛かるもの。**アイコン
  そのものは CC0** と README で宣言されている。このプロジェクトの
  「CC0 のみ」方針（`care-board-motifs.RESEARCH.md` §3、2026-09-09
  ユーザー確定）を満たす。share-alike も帰属表示義務も無い。

- 規模：749点（outline）。医療・介護の器具が体系的に揃っている。
- 構造：`viewBox 0 0 48 48`、パスは `fill="currentColor"` を自前で持つ
  **塗りのシルエット**。グラデーション0・transform 無し。SeiZen の
  視覚言語（単色フラット）とそのまま合う。

### 使ったファイル

| 用具 | 元ファイル | 元のパス |
|---|---|---|
| 介護ベッド（`bed`） | `inpatient.svg` | `public/icons/svg/outline/devices/inpatient.svg` |
| 車椅子（`chair`／`other` の受け皿） | `wheelchair.svg` | 同上 `devices/wheelchair.svg` |
| 杖（`cane`） | `cane.svg` | 同上 `devices/cane.svg` |
| （未使用・控え） | `crutches.svg` | 同上 `devices/crutches.svg` |

`inpatient` は**側面図でヘッドが上がり、キャスターが付いた寝台**で、
介護ベッド（ギャッチベッド）そのもの。自作の真上図より明確に良い。

素材は `render.js` の `EQUIP_IC` に**直接埋め込んである**
（`BODY_ART` と同じ理由――file:// で開くと `fetch` が CORS で拒まれ、
絵だけが消える）。このディレクトリの `.svg` は原本。差し替えるときは
こちらを直して `render.js` へ貼り直す。

## 不採用の記録

### `hospitalized.svg` / `observation.svg`（Health Icons）

どちらも `inpatient` と同じ寝台だが、**点滴スタンド**／**時計**が
付いている。意味が「入院中」「経過観察」に寄り、**家にある介護ベッド**
とは別のものになる。除外。

### `Medical hospital emergency beds.svg`（Wikimedia）

パブリックドメインだが**赤十字マークを含む地図記号**。国際法上規制された
シンボルで一般プロダクトには不適切。前回（2026-09-09）と同じ理由で除外。

### Openclipart の "walker"（56件）

**歩行器は1件も無い。** 検索に出るのは「犬の散歩をする人」「綱渡り
芸人」「Mary Edwards Walker（人名）」など、`walker` という語の別義
ばかり。`walker mobility` は0件。

### Material Symbols `assist_walker`

- https://github.com/google/material-design-icons
- **却下理由2つ**：
  1. 絵が違う ―― **杖をついて歩く人**であって歩行器（フレーム）ではない
  2. ライセンスが **Apache 2.0**。CC0のみの方針から外れる

## 歩行器（`walker`）だけ自作した

**CC0 に歩行器のグリフが存在しない**（上記の探索結果）。ユーザー判断
（2026-09-11）：「Health Icons に揃えて歩行器だけ描き起こす」。

Health Icons の規格に合わせた：

- `viewBox 0 0 48 48`、床面 y≈44、`fill="currentColor"` の塗りシルエット
- 骨の太さ 2px（`inpatient` の手すり・レールと同じ）
- 車輪は「外円＋内円」の抜き（`inpatient` のキャスターと同じ作り）
- 構成：持ち手（両端が手前へ曲がる）＋上枠＋開いた4本脚＋中段の横木
  ＋前脚のキャスター2つ

★試作は2案で止めた（CLAUDE.md §2 の検出器：座標を2回動かしたら
手を止める）。1回目は脚が垂直で「櫓」に見え、2回目で脚を開いて
キャスターを足したら成立した。3回目以降の座標いじりはしていない。

## 型（`EQUIP_KINDS`）の見直し

素材で**実物の絵が手に入るものだけを型にする**方針に変えた。

- **追加**：`chair`（車椅子）… 従来は `other`（箱＋丸の抽象記号）に
  埋もれていた。専用の絵を得たので独立させた。
- **追加**：`cane`（杖）
- **廃止**：`monitor`（見守り機器）… CC0 に実物の絵が無く、自作しても
  「壁掛けの箱＋電波」の抽象記号にしかならない。型として持つと
  「何の絵か言えない」ものが棚に並ぶ。該当する用具は `other` に落ちる。
- **`other` は車椅子の絵を借りる**（`EQUIP_IC.other = EQUIP_IC.chair`）。
  専用の絵が無いものに抽象記号を当てるより、いちばん近い実物の絵を
  借りて、区別は用具名の文字で付ける。

移行は `state.js` の版5→6（`MIGRATIONS[5]`）。旧 `monitor` と、
車椅子が入っていた旧 `other` は、用具名から型を引き直す。

## 適用範囲

**介護ゾーンだけ**（正本 §13）。ここで決めた素材・規格を医療ゾーン
（手帳）／銀行／保険へ持ち出さない。
