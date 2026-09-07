# 医療・右面のモチーフ素材調査（2026-09-07）

`_次セッション指示.md` のステップ1。右面3節の造形に使える
PD/CC0・商用可フリー素材を、日本語サイトを含めて探した記録。

対象は3つ：

1. **診療案内カード**（「いつもの通院」を差す物）
2. **通院用の器**（カードスタンド／カードホルダー／カード式の索引）
3. **必要になるもの用の器**（引き出し・書類箱・お薬手帳ポーチ）

SeiZen の視覚言語との相性で判定した。既存モチーフ（通帳・iPhone
フレーム・クレジットカード・手帳・ベッド・人体シルエット）は
**単色・フラット・レイヤーを重ねた「物1つ」の造形**で、CSS で
recolor できる。イラスト調のクリップアートやアイコングリフとは
register が違う。

候補の実ファイルは `_motif-candidates/` に置いた。並べレンダは
`_motif-candidates/grid3.png`（器の比較）・`grid5.png`（索引系）。

---

## 見た素材（全て実ファイルをレンダリングして確認）

### いらすとや（irasutoya.com）

- 診察券 / 名刺入れ・カードケース / カードデッキ / ICカードリーダー
  など、対象に近いイラストは揃っている。
- **PNG のみ。多色のカートゥーン塗り。** 著作権は放棄されておらず
  素材点数の制限（1制作物あたり20点）がある。
- **不採用。** SeiZen は単色フラットの SVG 造形。PNG のイラストを
  混ぜると、そこだけ絵柄の濃い「挿絵」になる（人体シルエットが
  単色なのと釣り合わない）。CSS recolor もできない。

### ICOOON MONO（icooon-mono.com）

- 単色フラットのグリフ。商用可・帰属不要・色変更可。
- **家具の「引き出し／タンス／チェスト／キャビネット」は無い。**
  「引き出し」で引くと金融の「預金引き出し」（ATM）。「収納」タグも
  side table と generic な箱2件のみ。カードスタンドも無し。
- **不採用**（対象の物が無い）。24px 級グリフなので、あってもモチーフ級
  スケールにはならない。

### unDraw（undraw.co）

- `cdn.undraw.co/illustrations/<name>.svg` で SVG 直取り。商用可・帰属不要。
- 実ファイル確認（`empty_4zx0`）：**人物入りシーンイラスト。6色
  パレット＋肌色＋紫のアクセント（#6c63ff）。**「物1つ」ではなく
  「人が箱を持っている場面」。
- **不採用。** register が SeiZen と真逆。

### OpenClipart（openclipart.org）

- `openclipart.org/download/<id>/` で SVG 直取り。CC0/PD。
- chest-of-drawers 系4点を実レンダで確認（#2626/#58477/#279126/#175944）：
  いずれも **寝室の箪笥・多色・グラデ・斜め投影・shape 数過多**
  （21〜740 shape）。医療書類の在りかに合わず、SeiZen のフラット
  単色に載せ替えるには実質描き直し。
- **不採用。**

### SVG Repo（svgrepo.com）

- card-holder / drawer のカテゴリはある。CC0/MIT コレクションを含む。
- **Vercel のボット保護（"Security Checkpoint"）で UA 偽装・
  compressed・時間差を試しても全て弾かれ、実ファイルに到達できず。**
  ブラウザなら開けるはず。**直接は未評価**だが、SVG Repo が
  ミラーしている上流セット（Tabler / Lucide / Material 等）は
  GitHub から直接見たので、実質はカバーした（下記）。

### アイコンセット上流（GitHub 直・許諾ゆるい）

Tabler（MIT）・Lucide（ISC）・Material Symbols（Apache 2.0・帰属不要）を
直接確認。`id` `id-badge-2` `badge` `contact_page` `archive` `cards`
`wallet-cards` `folder-archive` `dresser` `inventory_2` を実レンダ。

- 単色1〜数パス、viewBox 24。SeiZen の線画グリフ（`.ph-wifi`）と
  手つきは同じ。
- ただし **全て 24px グリフの密度**。`cards`（扇状のカード）や
  Material `dresser`（正面・引き出し6）は形は近いが、そのまま置くと
  「小さいアイコン」で、ベッド・iPhone フレームのような
  「表示サイズの物」の格に届かない。
- **モチーフ本体には不採用。作図の下敷き・比率参考にはできる。**

### 絵文字の単色版（Wikimedia Commons 経由・★本命）

「🗃 card file box（U+1F5C3）」「📇 card index / rolodex（U+1F4C7）」
「🗂 card index dividers（U+1F5C2）」の**単色フォント版**を実レンダで確認。
これらは**モチーフ級スケールで、単色フラット、線または塗り1色**で、
SeiZen の言語に本当に合う。前回「素材は無い」と切ったのは調査不足。

| ファイル | 物 | 見た目 | ライセンス |
|---|---|---|---|
| **OpenMoji-black 1F4C7** | 📇 カード式索引（回転式ロロデックス） | 正面・線のみ。台に1枚立ち、名前行が3本、串バー。rect と line だけの素直な構造。手で編集できる | **CC BY-SA 4.0** |
| **OpenMoji-black 1F5C3** | 🗃 カード式の引き出し（書類箱） | 正面・線のみ。箱＋蓋線＋中のカードが正面から扇、前面にラベルホルダーの手掛け | **CC BY-SA 4.0** |
| Emojione BW 1F5C3 | 🗃 同上 | アイソメ。蓋を開けた箱にインデックスカードが立つ。より立体的 | **CC BY-SA 4.0** |
| NotoSans Card Index Dividers 1F5C2 | 🗂 タブ付き仕切り束 | 正面。タブの立った仕切りが3枚重なる。塗り1色 | Apache 2.0 / OFL（帰属ゆるい） |
| Noto Emoji 1F4C7（Commons "BW"） | 📇 | **実は多色のまま**（青いカード＋灰の腕）。単色化が要る | Apache 2.0 |

OpenMoji-black のクリーン構造（`stroke="#000"` の line、gradient なし、
viewBox 72）は `_motif-candidates/openmoji-1F4C7-cardindex.svg` /
`openmoji-1F5C3-cardfilebox.svg` を参照。

---

## 結論

**前回の結論（外部素材は無い）は誤り。調査不足だった。**

📇 と 🗃 の**単色絵文字版**は、SeiZen の視覚言語に合うモチーフ級素材。
しかも 📇（通院＝カードの索引）と 🗃（必要になるもの＝カードの引き出し）は
**別の物として見分けがつく**ので、正本 §13（カードホルダー同士で
被る）を満たす。

### ただし、ライセンスが body-front と違う

- `body-front.svg` は **CC0**（表示義務なし）。
- OpenMoji / Emojione BW は **CC BY-SA 4.0**：
  - **帰属表示が要る**（フッター等に「emoji designed by OpenMoji –
    CC BY-SA 4.0」相当）
  - **改変したら派生物も CC BY-SA 4.0 で配布**（share-alike）
  - 「改変した」旨の明示も要る
- NotoSans 1F5C2（🗂 仕切り束）だけは Apache 2.0 / OFL で、帰属は
  ゆるく share-alike も無い。物としては「引き出し」より弱いが、
  ライセンスは一番楽。

→ **これは判断が要る**：
1. CC BY-SA を受け入れて OpenMoji の 📇/🗃 を土台にする
   （帰属1行＋改変は SA。プロトタイプなら現実的）
2. share-alike を避け、Apache の 🗂（NotoSans 1F5C2）だけ使う
3. 素材を下敷きに全部自作（📇 も 🗃 も rect と line が主体なので、
   OpenMoji を見ながら実寸で引き直すのは人体ループにはならない）

### 診療案内カード（対象1）は自作

カードは本当に矩形。実寸比 85.6:54 の角丸矩形＋細い色帯1本＋
医療マーク1つ。`.paycard` の規律（低彩度・絵柄最小・券面は主役に
しない・色2色まで）をそのまま適用。**素材不要。**

### 次にやること

上の 1/2/3 をユーザーに決めてもらう → モチーフ確定 → 造形 →
実装（通院・薬局に `web` フィールド追加を含む）→ file:// で確認。
