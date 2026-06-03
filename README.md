# حرف ولون - Letter & Color Game

Real-time multiplayer Arabic letter game. Two teams compete to color 28 Arabic letters by answering questions correctly.

---

## Quick Setup (5 minutes)

### 1. Create Firebase Project
1. Go to **https://console.firebase.google.com/**
2. Click **"Add project"** → name it → create
3. In the left sidebar: **Build → Realtime Database → Create Database**
4. Choose **"Start in test mode"** → Enable

### 2. Get Your Config
1. Click the ⚙️ gear icon → **Project Settings**
2. Scroll to **"Your apps"** → click **`</>`** (Web)
3. Register app → copy the `firebaseConfig` values

### 3. Edit firebase-config.js
Replace the placeholder values with your real Firebase config:
```js
const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123..."
};
```

### 4. Set Database Rules
Firebase Console → Realtime Database → Rules tab → paste:
```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```
Click **Publish**.

### 5. Deploy to GitHub Pages
1. Create a GitHub repo (Public)
2. Upload ALL files (including `.nojekyll`)
3. Go to repo **Settings → Pages**
4. Source: `main` branch, `/ (root)` folder → **Save**
5. Wait 2 minutes → your site is live!

---

## How to Play

### Judge (Game Master)
1. Open `index.html` → Create a room → get 6-digit code
2. Share the code/QR codes with players
3. Click **"دخول كحكم"** (Enter as Judge) → opens judge dashboard
4. Click **"توليد سؤال"** to generate a question (you see the answer, players don't)
5. Select which team answers first → click **"ابدأ المؤقت"** (Start Timer)
6. The 10-second countdown begins on ALL screens
7. First player from the active team to hit the buzz button gets to answer
8. Player types their answer → you see it → click ✅ Correct or ❌ Wrong
9. Wrong answer → automatically passes to the other team for another 10 seconds
10. Correct → that letter gets colored in the team's color

### Players
1. Open the link or scan QR code
2. Enter your name → join Red or Blue team
3. Wait for the judge to start a round
4. When it's your team's turn, smash the buzz button first!
5. Type your answer quickly!

### Winning
- Game ends when all 28 letters are colored, or judge ends it
- Team with most colored letters wins! 🏆

---

## File Structure
```
index.html          ← Home, room creation/joining
player.html         ← Player game view
judge.html          ← Judge control dashboard
style.css           ← All styles (RTL, dark theme)
app.js              ← Shared Firebase logic
questions.js        ← 470+ Arabic questions
firebase-config.js  ← YOUR FIREBASE CONFIG (edit this!)
README.md           ← This file
.nojekyll           ← Required for GitHub Pages
```

---

## Judge URL
After creating a room with code `123456`, the judge goes to:
`https://yoursite.github.io/harf-wa-lawn/judge.html?room=123456`

Players join via:
`https://yoursite.github.io/harf-wa-lawn/player.html?room=123456&team=red`
