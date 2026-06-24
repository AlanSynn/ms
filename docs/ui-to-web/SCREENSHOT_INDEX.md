# UI Screenshot Index

캡처 환경: `QT_QPA_PLATFORM=offscreen uv run python ui-to-web/tools/capture_ui_screenshots.py`
목적: 실제 Qt 런타임 레이아웃, 탭 구성, 패널 밀도, 버튼 배치, 그리드/캔버스 위치를 웹 리빌드 기준 이미지로 보존.

| Screenshot | UI 상태 | 주요 확인 포인트 |
| --- | --- | --- |
| ![](screenshots/01-main-tab-character-selection.png) | Character Selection tab | 좌측 입력/인식/뷰/캐릭터/출력 패널 + 우측 ImageProcessingView 캔버스/그리드 |
| ![](screenshots/02-main-tab-path-editor.png) | Path Editor tab | 좌측 Parts/Motion Path/Animation/View Controls + 우측 EditorView 캔버스/그리드 |
| ![](screenshots/03-main-tab-mechanism-design.png) | Mechanism Design tab | 좌측 mechanism parts/generation/animation/blueprint/view controls + 우측 캔버스/그리드 |
| ![](screenshots/04-main-tab-mechanism-foundry.png) | Mechanism Foundry gallery | GalleryView 카드형 mechanism 선택 화면 |
| ![](screenshots/90-options-dialog.png) | Options dialog | Appearance/Simulation/Performance/Workflow/Fabrication/Grid settings |
| ![](screenshots/91-processing-steps-group.png) | ProcessingStepsGroup | 상세 처리 버튼 묶음 |
| ![](screenshots/92-character-selection-dialog.png) | CharacterSelectionDialog | 프리셋 캐릭터 선택 다이얼로그 |
| ![](screenshots/93-manual-segmentation-editor.png) | Manual Segmentation Editor | part layer 라디오, skeleton point/layer add/remove, segmentation action buttons |
| ![](screenshots/94-custom-coupler-dialog.png) | Custom Coupler Path dialog | slider + numeric spinbox + OK/Cancel |
| ![](screenshots/95-recommendation-dialog-empty.png) | Recommendation dialog empty state | 추천 결과 grid/placeholder/Close layout |

원본 캡처 로그: [`screenshots/capture-results.md`](screenshots/capture-results.md)
