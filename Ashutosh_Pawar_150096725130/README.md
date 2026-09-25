# Real-Time Group Chat & Messaging Engine

Assignment 13 - Ashutosh Pawar (150096725130)

Multi-room chat built with Express and Socket.io. A user logs in with a name
and avatar, picks a channel (`#general`, `#developers`, `#random`, `#gaming`,
`#tech`) or creates a new one, and chats in real time with everyone in that
room. Joining a room replays its last 50 messages from an in-memory buffer.
Each room shows who is inside it, a debounced "Aarav is typing..." indicator
reaches only that room, and any online user can be sent a private direct
message that is delivered to their socket alone. The dark-theme frontend in
`public/` is served by the same server.

## Tech stack

- Node.js, Express 5
- Socket.io (server + browser client)
- dotenv, cors
- HTML + CSS + plain JS + SweetAlert2 for the frontend

## Project structure

```text
Ashutosh_Pawar_150096725130/
├── public/
│   ├── index.html        # login card + sidebar (rooms, online users) + chat pane
│   ├── app.js            # socket listeners, typing debounce, DM threads, rendering
│   └── style.css         # dark theme, chat bubbles, sidebar, mobile layout
├── sockets/
│   ├── chatHandler.js    # chat:send, typing:start/stop, direct:send
│   └── userHandler.js    # user:login, room:join/leave, presence, disconnect
├── utils/
│   └── messageStore.js   # per-room history buffer (last 50), room name cleanup
├── .env.example
├── .gitignore
├── package.json
├── server.js             # Express static server + Socket.io bootstrap
└── README.md
```

## Setup

```bash
npm install
cp .env.example .env
npm run dev      # or: npm start
```

Open `http://localhost:5000` in a few tabs, log in with a different name in
each.

## Environment variables

| Variable | Required | Notes              |
| -------- | :------: | ------------------ |
| `PORT`   |    no    | defaults to 5000   |

## Server state

```js
const connectedUsers = new Map(); // socketId -> { username, avatar, currentRoom }
const roomHistories = { general: [], developers: [], random: [], gaming: [], tech: [] };
const MAX_HISTORY = 50;           // oldest message is shifted out past 50
```

A user sits in one room at a time (`currentRoom`). Joining another room leaves
the old one first. Room names are cleaned (`"#My Room!"` → `my-room`), and a
new name creates the room for everyone.

## Socket events

### Session & rooms

| Event            | Direction        | Payload                                         | Notes                                   |
| ---------------- | ---------------- | ----------------------------------------------- | --------------------------------------- |
| `user:login`     | client → server  | `{ username, avatar }`                          | name must be unique among online users  |
| `user:ready`     | server → client  | `{ id, username, rooms }`                       | login accepted                          |
| `users:online`   | server → all     | `{ users: [{ id, username, avatar, room }] }`   | presence; `id` is used for DMs          |
| `rooms:list`     | server → all     | `{ rooms }`                                     | sent when a new room is created         |
| `room:join`      | client → server  | `{ room }`                                      | leaves the current room first           |
| `room:history`   | server → client  | `{ room, messages }`                            | last 50 messages, sent to the joiner    |
| `room:userlist`  | server → room    | `{ room, users }`                               | on every join / leave / disconnect      |
| `room:notice`    | server → room    | `{ room, text }`                                | "Priya joined #developers"              |
| `room:leave`     | client → server  | `{ room }`                                      |                                         |

### Messaging & indicators

| Event            | Direction                  | Payload                                           | Notes                                      |
| ---------------- | -------------------------- | ------------------------------------------------- | ------------------------------------------ |
| `chat:send`      | client → server            | `{ room, message }`                               | rejected unless the sender is in the room  |
| `chat:receive`   | server → room              | `{ id, room, sender, avatar, message, timestamp }`| also stored in history                     |
| `typing:start`   | client → server            | `{ room }`                                        |                                            |
| `typing:stop`    | client → server            | `{ room }`                                        |                                            |
| `typing:update`  | server → room (not sender) | `{ username, isTyping }`                          | `socket.to(room)`                          |
| `direct:send`    | client → server            | `{ recipientId, message }`                        | `recipientId` = socket id from `users:online` |
| `direct:receive` | server → recipient only    | `{ fromId, from, message, timestamp }`            | `io.to(recipientId)`                       |
| `direct:sent`    | server → sender            | `{ toId, to, message, timestamp }`                | echo for the sender's DM thread            |
| `chat:error`     | server → client            | `{ message }`                                     | validation errors                          |

## Typing indicator debounce

- **Client:** the first keystroke sends one `typing:start`. Every keystroke
  resets a 1.5 s timer; when it fires (user went idle), `typing:stop` is sent.
  Sending a message or switching room also sends `typing:stop`.
- **Server:** only the first `typing:start` is broadcast; repeats just push back
  a 5 s safety timeout. If a client never sends `typing:stop` (tab closed
  mid-word), the timeout clears the indicator for the room anyway. Sending a
  message clears it too.

## Validation

- Messages are trimmed, empty ones dropped, capped at 1000 characters.
- `chat:send` only works for a room the socket actually joined.
- DMs to yourself or to an offline user return `chat:error`.
- Everything is rendered with escaped text on the client (no HTML injection).

## Testing

1. Start the server, open three tabs: Aarav, Priya, Rohan.
2. Aarav and Priya join `#developers`, Rohan joins `#random`.
3. Aarav types in `#developers`: only Priya sees "Aarav is typing...".
4. Aarav sends messages: Priya gets them live, Rohan gets nothing.
5. A fourth tab joins `#developers`: the earlier messages show up at once
   from history.
6. Aarav clicks Priya in the **Online** list and sends a DM: Priya gets a
   toast and an unread badge, Rohan gets nothing.
