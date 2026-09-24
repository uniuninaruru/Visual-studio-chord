# 和声法・対位法エンジンの公開教科書台帳

確認日: 2026-09-25。教科書本文・譜例・音声はリポジトリへ複製せず、章へのリンクと自分たちの実装規則を管理する。資料の規則は歴史的な様式の説明であり、あらゆるジャズ／現代音楽に適用する普遍的な禁止事項ではない。

## 第1資料: Open Music Theory, 第2版

- 著者: Mark Gotham, Kyle Gullings, Chelsey Hamm, Bryn Hughes, Brian Jarvis, Megan Lavengood, John Peterson ほか章著者。オンライン版の[序文とライセンス](https://viva.pressbooks.pub/openmusictheory/front-matter/introduction/)は、別記の素材を除き **CC BY-SA 4.0** と明記する。引用や図版の再利用時は、個別の権利表示も確認する。
- [第1種対位法](https://viva.pressbooks.pub/openmusictheory/chapter/first-species-counterpoint/): 2声の協和、声部独立、平行完全音程、始まりと終わり。規則ID `CP-1`。
- [第2種対位法](https://viva.pressbooks.pub/openmusictheory/chapter/second-species-counterpoint/): 強拍の協和と弱拍の経過的不協和。規則ID `CP-2`。
- [第3種対位法](https://viva.pressbooks.pub/openmusictheory/chapter/third-species-counterpoint/): より細かい音価での経過・隣接音の前後関係。規則ID `CP-3`。
- [第4種対位法](https://viva.pressbooks.pub/openmusictheory/chapter/fourth-species-counterpoint/): 掛留の準備・保持・解決。規則ID `CP-4`。
- [和声、終止、フレーズ](https://viva.pressbooks.pub/openmusictheory/chapter/intro-to-harmony/): フレーズ末尾から機能和声を計画する。規則ID `H-FORM`。
- [ジャズのボイシング](https://viva.pressbooks.pub/openmusictheory/chapter/jazz-voicings/): 3度と7度の連結、低音域の間隔、5度の省略。規則ID `J-GUIDE`。
- [コード・スケール理論](https://viva.pressbooks.pub/openmusictheory/chapter/chord-scale-theory/): 強拍のコードトーンと装飾音。ただしスケールだけで声部連結は決まらない。規則ID `J-MELODY`。
- [ブルース和声](https://viva.pressbooks.pub/openmusictheory/chapter/blues-harmony/): I7・IV7を通常のV7の未解決と誤判定しない。規則ID `J-BLUES`。

## 第2資料: Music Theory for the 21st-Century Classroom

- 著者: Robert Hutchinson。[書籍トップ](https://musictheory.pugetsound.edu/)にオンライン版と2025年9月版PDFがある。[Colophon](https://musictheory.pugetsound.edu/mt21c/colophon-1.html)は、不変部分・表紙文なしの **GNU Free Documentation License 1.2 またはそれ以降** と明記する。本文の転載には同ライセンスの条件を満たす必要があるため、この台帳ではリンクと独立した要約のみを使う。
- [Voice Leading](https://musictheory.pugetsound.edu/mt21c/VoiceLeading.html): 声部独立と歌いやすさ。規則ID `VL-INDEPENDENCE`。
- [Objectionable Parallels](https://musictheory.pugetsound.edu/mt21c/ObjectionableParallels.html): 平行5度・8度を厳格対位法プロファイルで判定する。規則ID `CP-PARALLEL`。
- [Jazz Chord Voicings](https://musictheory.pugetsound.edu/mt21c/JazzChordVoicings.html): 3度・7度、シェル、拡張音の置き方。規則ID `J-VOICING`。
- [Standard Chord Progressions](https://musictheory.pugetsound.edu/mt21c/StandardChordProgressions.html): ii–V–Iなどを曲の節目と結びつける。規則ID `J-CADENCE`。

## 取り込み順

1. 第1種とボイシング: 声部の音域、交差、実際に鳴る協和、ガイドトーンの連結を共通の時刻グリッドで実装する。
2. 第2・第3種と装飾音: 強拍の着地点を決めた後、第2種の経過音、第3種の隣接音、ジャズ様式のクロマティック接近を生成し、前後の音で検証する。
3. 第4種とフレーズ和声: 掛留を準備・保持・解決の3段階で扱い、終止・転調・セクション接続をフレーズ全体で評価する。
4. ジャズ資料: 3度・7度の連結と様式別の拡張音を適用する。ブルースやモーダル曲に厳格な共通慣習和声の禁止規則を強制しない。

資料の追加時は、著者、版・更新日、章URL、ライセンス、規則ID、適用する様式、対照テストをこの台帳に追加する。実装上の係数は教科書から測定された統計値として表示しない。
