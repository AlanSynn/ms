# Web Port Gaps, Risks, and Regression Targets

## Highest-risk areas

1. **Coordinate duplication across tabs**
   Current Qt uses multiple view/scene surfaces. Web must keep canonical mm coords in one scene store.

2. **Parametric editing display/state drift**
   Handles computed from current mechanism params on render. Drag updates same canonical params, then re-render. No second hidden copy of handle positions.

3. **Foundry → Mechanism Design instance identity**
   Multiple same-type mechanisms must not collapse into one. Use unique IDs, not mechanism type as dict key.

4. **Blueprint/assembly guide state loss**
   Export reads actual `MechanismInstance` transform/board/character state. No generic/default board placement if real state exists.

5. **Grid/sheet inconsistency**
   2cm grid and Letter sheet fitting = app-wide physical context, not per-tab defaults.

6. **Body part/skeleton editing**
   Adding/removing skeleton points and body part layers must update project state, character rendering, path binding, mechanism binding, blueprint export refs.

## Regression tests to create in web rebuild

| Test | Expected |
| --- | --- |
| Tab switch preserves viewport | pan/zoom unchanged after Character → Editor → Mechanism → Editor |
| Same character transform everywhere | body part bbox match in all tabs |
| Grid pitch app-wide | grid spacing identical in Character, Editor, Mechanism, Foundry |
| Drag param handle | numeric param and rendered handle agree after drag |
| Partial 4-bar valid range | UI shows valid angle interval, allows animation within interval |
| Duplicate same-type mechanisms | two 4-bars stay two distinct instances in design + blueprint |
| Foundry export position | Add to Mechanism Tab preserves board coords + output point |
| Skeleton point add/remove | all tabs reflect changed skeleton, no stale joint graphics |
| Body part layer add/remove | layer list, canvas, path binding, blueprint all update |
| Blueprint export state | assembly guide uses actual scene placement |