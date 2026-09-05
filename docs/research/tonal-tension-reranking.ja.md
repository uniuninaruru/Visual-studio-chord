# TISによるセクション緊張カーブ再順位付け

状態: **実装済みのブラウザ内適応**。これは、既存の機能和声ジェネレーターが
作ったコードを小節単位で8候補比較する仕組みです。Transformer、学習済みモデル、
モデル重み、または2020年モデルの階層木項を追加したものではありません。

## 何を選ぶか

新しく評価するautomatic group/sectionごとに、`generateSectionedChords` は、機能和声とTISが
有効で、top-levelの`settings.progressionId`がなく、組み立て済み`arrangementPlan`でもない
場合に、既存のcadence/grammar制約を通過する`generateProgression`から8候補を評価します。
同じplanner groupの互換する反復sectionはcached resultを再利用するため、8回の新しい呼出しを
繰り返しません。
候補0はsectionに planner が付けたcatalog `progressionId` と従来のセクションseedを使う
baselineです。候補1〜7は`progressionId: undefined`を明示した機能和声候補で、決定的に
導出したseedを使います。`style: random`でも候補1〜7は候補0の解決済みstyleを共有し、
cadenceは各候補の有効なものを保ちます。

ユーザーがtop-levelの`settings.progressionId`を指定した場合は、song formがあっても
全planned sectionへ実際にその進行を適用し、sectioned path全体でTISをバイパスします。
これはplannerが選んだIDをたまたま残すだけではなく、明示的な名前付きtemplateの契約です。
同じ`progressionId`を共有するplanner反復groupは、派生candidate stream、解決済みstyle、
選択したoriginal candidate indexを共有します。互換する長さ・key・modeの反復sectionは
選択結果そのものも再利用するため、AABAや戻ってくるverse/chorusがrestatementになります。

候補はroot + qualityの列だけでなく、実際のsounding tick位置・duration・sort済みMIDI note列・
bassで重複排除します。2候補未満、空または非有限の曲線、計算例外では候補0をそのまま使います。
top-levelの明示的な名前付き進行と、ユーザー組立の`arrangementPlan`由来セクションはこの経路を
通りません。planner内部のcatalog IDは自動候補のbaselineとして扱います。正常に評価された
セクションだけ`tonalTensionApplied: true`となり、catalog baselineが勝てばIDを保持し、
機能和声候補が勝てば出力sectionからIDを外します。range-based partial regenerationは
section全体を置換しないため、候補0を使います。実際にunlocked barを1つ以上置換したsection
だけ古いTIS markerを外し、範囲が重なっても全bar lockedのsectionはmarkerを保持します。
触れていないsectionのmarkerも保持します。触れた範囲について、新しいsection全体をTIS評価
したとは主張しません。

## TIS記述とプロフィール

MIDIピッチ（またはpitch class）の数え上げを `c(n)` とした12次元chroma countに対し、
`k=1..6` の複素DFTを重み付けし、総質量で割ります。

`T(k) = w_k / Σc(n) · Σ[n=0..11] c(n) exp(-j 2πkn/12)`

重みは `[2, 11, 17, 16, 19, 7]`、複素数はブラウザで扱える `{real, imag}` の組です。
空ベクトルの角度は0とし、内積角のcos値は`[-1, 1]`へclampします。

- TIS Euclidean距離: `sqrt(Σ(real差² + imag差²))`
- key距離: chord TIVと現在のkey/mode scale TIVの角度
- 機能距離: chord − keyを、tonic / subdominant / dominant − keyと比較した最小角度
- dissonance: `clamp(1 − ||T|| / sqrt(Σw_k²), 0, 1)`
- chord-to-chord距離: Euclidean距離を **64.8757** で割る

機能テンプレートはtonic rootを2倍し、tonic/subdominantは現在のscaleのdiatonic
構成、dominantはminorでもmajor triadとします。Dorian/Mixolydianなども同じ記号規則で
扱えますが、根拠となる知覚評価は主にmajor/minorと短い進行です。

前コードとの声部特徴は、同じ音数ならright rotation 1から開始して未回転を最後に調べる最小
circular mapping（同点時も参照実装と同じ決定順）、違う音数なら
ソートしたpitch-class列を全回転し、端点の反復を許す決定的minimum mappingです。各pairの
pitch/key/function項を合計し、`exp(-0.05 * semitoneCost * pairTerm)` とします。
プロフィールの合計は次のとおりです。

`chordDistance + 1.58·keyDistance + tonalFunctionDistance + 30.3·dissonance + 2.71·voiceLeading`

最初のコードのchord-distanceとvoice-leadingは0です。実装はこの各項を監査用に返します。
この実装のdissonance分母は厳密な`sqrt(sum(weights^2))`を毎回計算します。参照実装が
公開している最大値は約`32.8631`へ丸められているため、丸め定数とのbit単位一致は主張しません。

## 小節曲線と再順位付け

コードのプロフィール値は、コードが小節内で占める整数tick数を重みにして小節へ平均します。
targetは既存の`planSectionEnergy` / `energyAtBar`から、そのセクションの局所的な
`start → peak → end`配列として作ります。これはこのアプリのshape guidanceであり、
TISの生スカラーとエネルギーの絶対値が同じだという主張ではありません。

候補とtargetの両方の分散が`1e-3`以上ならPearson相関を使います。それ以外はraw meanを
比較しない決定的fallbackを使います。両方flatなら`1`、targetがflatなら`1 / (1 + candidate variance)`
で小さい分散を単調に優先し、targetがnon-flatでcandidateがflatなら`-1`、それ以外はPearsonです。
同点ではcandidate 0が優先されます。partial regenerationではsection-wideなTIS適用を主張せず、
実際に置換したsectionの古いmarkerだけを外し、触れていないmetadataは保持します。

すべての計算は依存パッケージなしでブラウザ内・offlineに実行されます。targetはsection-localな
shape guidanceであり、section間の絶対レベルや、後段のtransition挿入・再voicing後の最終曲線の
完全一致は保証しません。pivot／transition／左右手の割当／再voicing後の最終出音がtargetと
一致することも保証しません。ユーザー組立のarrangementはこの再順位付け経路へ入らず、source
sectionを独立生成して後からassembleします。top-levelの明示的な名前付き進行は厳密にそのままです。保存JSONでは
`tonalTension: { enabled }`が任意項目で、旧JSONは変更せず読めます。出荷時はON、互換用の
`MINIMAL_GENERATOR_SETTINGS`では不在/OFFです。

## 主張しないこと

- これはTransformerでも、学習済みモデルでも、推論時model weightでもありません。
- Navarro-Cáceres et al. (2020)の階層木・長期構造項を実装していません。
- このアプリでの聴感改善はまだ証明しておらず、blind listening studyが必要です。
- 参照実験の知覚評価は主にmajor/minor、短いコード進行を対象とします。
- 8候補の比較は既存ジェネレーターへの適応であり、2025年論文の完全なdual-level
  beam-search decodeを再現するものではありません。

## 参考資料

- Bernardes et al. (2016), “A Multi-Level Tonal Interval Space for Modelling Pitch Relatedness and Musical Consonance,” [DOI](https://doi.org/10.1080/09298215.2016.1182192)
- Navarro-Cáceres et al. (2020), “A Computational Model of Tonal Tension Profile of Chord Progressions in the Tonal Interval Space,” [DOI](https://doi.org/10.3390/e22111291)
- Ebrahimzadeh et al. (2025), “Explicit Tonal Tension Conditioning via Dual-Level Beam Search for Symbolic Music Generation,” [arXiv:2511.19342](https://arxiv.org/abs/2511.19342)
- 2025年の公式実装（プロフィールの係数・定数を照合）: [tension-beamsearch](https://github.com/MaraalE/tension-beamsearch)
- TIVlib（DFT/TISの背景）: [TIVlib](https://github.com/aframires/TIVlib)
