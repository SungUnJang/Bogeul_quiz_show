# 🫧 보글보글 퀴즈쇼

실시간 멀티플레이 웹게임 (한 방 최대 15명). **OX 게임**과 **그림 맞추기** 두 가지 모드가 있어요.
외부 패키지가 하나도 없는 Node.js 서버라 `npm install` 없이 바로 실행돼요.

## 폴더 구성
```
server.js            ← 서버 + 게임 규칙 (⏱ 시간 설정은 맨 위 CONFIG)
questions_easy.txt   ← OX 이지 모드 문제 (초등학생 수준, 100문제)
questions_hard.txt   ← OX 하드 모드 문제
words.txt            ← 그림 맞추기 제시어 (약 100개)
public/
  index.html         ← 화면 구조
  style.css          ← 디자인
  app.js             ← 게임 화면 동작 (BGM/효과음, 번개 연출, 그림 그리기)
  img/               ← main.webp(메뉴) game.webp(OX) draw.webp(그림) + 캐릭터 16개
render.yaml          ← Render 배포 설정
package.json
```

## 내 컴퓨터에서 실행
```bash
node server.js
# → http://localhost:3000 접속
```

## Render 배포
1. 이 폴더의 **내용물**을 GitHub 저장소 맨 위에 올려요. (저장소 첫 화면에 server.js 가 보여야 해요)
2. https://dashboard.render.com → **New +** → **Web Service** → 저장소 선택
3. Build Command `npm install` / Start Command `node server.js` / Instance Type `Free` → **Deploy**
4. 수정할 때는 바뀐 파일만 GitHub에 다시 올리면 Render가 자동으로 다시 배포해요.

## 설정 바꾸기 (server.js 맨 위 CONFIG)
| 항목 | 기본값 | 설명 |
|---|---|---|
| `ANSWER_TIME_SEC` | 10 | OX 문제당 답 고르는 시간(초) |
| `DRAW_TIME_SEC` | 90 | 그림 한 문제 제한 시간(초) |
| `DRAW_WIN_SCORE` | 3 | 몇 번 먼저 맞히면 우승 |
| `MAX_PLAYERS` | 15 | 한 방 최대 인원 |

캐릭터 이동 속도는 `public/app.js` 맨 위 `SPEED` 에서 바꿔요. (`draw`: 그림 그릴 때, `ride`: 비눗방울 탔을 때)

## 문제 / 제시어 추가
- OX: `questions_easy.txt` 또는 `questions_hard.txt` 에 `[문제] 내용 (O)` 형식으로 한 줄씩.
- 그림: `words.txt` 에 한 줄에 하나. 같은 정답으로 인정할 말은 `|` 로 이어 써요. 예) `텔레비전|티비|TV`
  (띄어쓰기·대소문자는 무시하고 채점해요)

## 게임 규칙
**공통**: 게임을 고른 뒤 방 목록에서 방을 고르거나 **＋ 방 만들기**. 방을 만든 사람이 👑방장 (나가면 다음 사람에게 넘어가요). 🔗 버튼으로 초대 링크 복사.

**OX 게임**
- 방장이 🐣이지 / 🔥하드 난이도를 고르고 시작
- 제한 시간 안에 O / X 구역으로 이동 (가운데 선 위 = 탈락)
- 틀리면 ⚡번개를 맞고 👻유령이 돼요. 유령도 돌아다닐 수 있지만 **유령끼리만** 서로 보여요.
- 마지막 1명이 남으면 우승

**그림 맞추기** (2명 이상)
- 랜덤으로 뽑힌 출제자만 경기장에 보이고, 걸어간 길이 진한 흙으로 남아 그림이 돼요.
- 왼쪽 아래 **🫧 탑승**(또는 스페이스바): 비눗방울을 타고 흔적 없이 이동 → **착지** 후 다시 그리기
- 🧽 다시 그리기: 출제자가 그림을 모두 지우기
- 나머지는 입력창에 정답 입력. **가장 먼저 맞힌 사람이 다음 출제자**, 아무도 못 맞히면 다른 사람이 랜덤으로 출제
- 먼저 **3번** 맞힌 사람이 우승
