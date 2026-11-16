# 🫧 보글보글 퀴즈쇼

실시간 멀티플레이 OX 퀴즈 웹게임 (한 방 최대 15명). 외부 패키지가 하나도 없는 Node.js 서버라 `npm install` 없이 바로 실행돼요.

## 폴더 구성
```
server.js        ← 서버 + 게임 규칙 (⏱ 문제 시간 설정은 맨 위 CONFIG)
questions.txt    ← 문제 목록 (한 줄에 한 문제, 끝에 (O) 또는 (X))
public/
  index.html     ← 게임 화면 (메뉴, 캐릭터 선택, OX 경기장, BGM/효과음)
  img/           ← 배경 2장 + 캐릭터 16개 (char01~char16.png)
render.yaml      ← Render 배포 설정
package.json
```

## 내 컴퓨터에서 실행
```bash
node server.js
# → http://localhost:3000 접속
```

## Render 배포
1. 이 폴더를 GitHub 저장소에 올려요. (zip 압축을 풀고 안의 파일들을 그대로 업로드)
2. https://dashboard.render.com → **New +** → **Web Service** → 방금 만든 저장소 선택
3. 아래처럼 입력하고 **Create Web Service**
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Instance Type: Free (원하면 유료)
4. 배포가 끝나면 나오는 `https://○○○.onrender.com` 주소를 친구들에게 공유하면 끝!

> `render.yaml`이 들어 있어서 **New + → Blueprint**로 저장소를 고르면 위 설정이 자동으로 채워져요.
> 무료 인스턴스는 한동안 접속이 없으면 잠들어서, 첫 접속 때 깨어나는 데 잠깐 걸릴 수 있어요.

## 설정 바꾸기
- **문제 시간(초)**: `server.js` 맨 위 `CONFIG.ANSWER_TIME_SEC: ... || 10` 의 `10`을 바꿔요.
  (Render 대시보드 Environment에 `ANSWER_TIME_SEC=15`처럼 넣어도 돼요.)
- **문제 추가/수정**: `questions.txt`에 `[문제] 내용 (O)` 형식으로 한 줄씩 추가. 정답 표시가 없는 줄은 자동으로 건너뛰어요.
- **방 나누기**: 주소 뒤에 `?room=1반` 대신 영문/숫자로 `?room=class1` 처럼 붙이면 서로 다른 방에서 따로 게임해요.

## 게임 규칙
- 먼저 입장한 사람이 👑방장 → **게임 시작** 버튼
- 문제가 나오면 제한 시간 안에 O / X 구역으로 이동 (바닥 터치, O·X 거품 버튼, 방향키·WASD, 키보드 O/X)
- 가운데 선 위 = 선택 안 함 = 탈락
- 한 번 틀리면 게임이 끝날 때까지 👻관전자 모드 (나갔다 들어와도 이번 게임엔 재참가 불가)
- 게임 중에도 새 참가 가능, 마지막 1명이 남으면 우승
- 배틀 게임은 아직 미구현
