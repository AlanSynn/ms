# Automataii UI → Web Porting Bundle

이 디렉터리는 현재 PyQt6 UI를 웹/캔버스 기반 앱으로 재구축하기 위한 UI 문서화 번들입니다.

## 포함된 산출물

| 파일/폴더 | 내용 |
| --- | --- |
| `UI_TO_WEB_PORT_SPEC.md` | 메인 윈도우, 탭, 메뉴, 버튼, 다이얼로그, 상태 흐름, 웹 컴포넌트 대응표 |
| `CANVAS_LAYER_STRATEGY.md` | 탭을 바꿔도 단일 캔버스를 유지하고 레이어 visibility만 바꾸는 웹 설계안 |
| `SCREENSHOT_INDEX.md` | 캡처된 UI 스크린샷 목록과 출처/용도 |
| `inventory/qt_ui_inventory.md` | `src/automataii/presentation/qt/**/*.py` 자동 스캔 결과: UI 클래스와 텍스트/컨트롤 호출 |
| `inventory/qt_ui_inventory.json` | 위 인벤토리의 기계 판독용 JSON |
| `inventory/source-files.md` | UI 관련 Python 파일 인덱스 |
| `screenshots/*.png` | 오프스크린 Qt 런타임 캡처 이미지 |
| `tools/capture_ui_screenshots.py` | 스크린샷 재생성 스크립트 |

## 재생성

```bash
QT_QPA_PLATFORM=offscreen uv run python ui-to-web/tools/capture_ui_screenshots.py
python3 ui-to-web/tools/extract_qt_ui_inventory.py  # 현재 세션에서 사용한 자동 인벤토리 생성 스크립트
```

> 참고: `inventory/qt_ui_inventory.json`은 226개 Qt presentation Python 파일을 스캔해 UI-ish class 193개, UI call 730개를 기록했습니다. 일부 비위젯 QObject/서비스 클래스도 PyQt import 때문에 포함될 수 있으므로, 웹 포팅 때는 `UI_TO_WEB_PORT_SPEC.md`의 수동 정리표를 우선 기준으로 삼으세요.

## 웹 리빌드 핵심 방향

현재 Qt 앱은 탭마다 별도 `QGraphicsView/QGraphicsScene` 성격이 강합니다. 웹에서는 사용자가 요청한 대로 **하나의 persistent canvas scene**를 중심에 두고, 탭은 좌측/상단 도구 패널과 레이어 visibility preset만 바꾸는 구조가 더 안전합니다.

핵심 레이어:

1. sheet/grid/background
2. source image / character parts
3. skeleton bones/joints
4. motion path draw/edit
5. mechanism instances
6. parametric handles/temporary overlays
7. foundry preview/blueprint/fabrication overlays
8. debug/status overlays

자세한 설계는 `CANVAS_LAYER_STRATEGY.md`를 보세요.
