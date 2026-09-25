const socket = io();

const AVATARS = ["🦊", "🐼", "🐯", "🐸", "🐙", "🦉", "🐧", "🐨"];
// stop "is typing" after this long without a keystroke
const TYPING_IDLE_MS = 1500;

const loginEl = document.getElementById("login");
const appEl = document.getElementById("app");
const statusEl = document.getElementById("status");
const roomList = document.getElementById("room-list");
const onlineList = document.getElementById("online-list");
const messagesEl = document.getElementById("messages");
const typingEl = document.getElementById("typing");
const titleEl = document.getElementById("chat-title");
const subEl = document.getElementById("chat-sub");
const messageInput = document.getElementById("message");

let me = null; // { id, username, avatar }
let avatar = AVATARS[0];
let rooms = [];
let onlineUsers = [];
let roomMembers = [];
// what the main pane shows: { type: "room", room } or { type: "dm", id, name }
let view = { type: "room", room: "general" };
let currentRoom = null;
let lastRoom = "general"; // rejoined after a reconnect
const dmThreads = {}; // socketId -> [{ from, message, timestamp, mine }]
const unread = {}; // socketId -> count
const typingUsers = new Set();
let typingTimer = null;
let isTyping = false;

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function toast(icon, title) {
  Swal.fire({ toast: true, position: "top", icon, title, showConfirmButton: false, timer: 2200 });
}

function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addBubble({ sender, avatar: face, message, timestamp, mine, dm }) {
  const div = document.createElement("div");
  div.className = `bubble${mine ? " mine" : ""}${dm ? " dm" : ""}`;
  div.innerHTML = `<div class="meta"><span>${escapeHtml(face || "")} ${escapeHtml(sender)}</span><span>${escapeHtml(timestamp)}</span></div>
    <div>${escapeHtml(message)}</div>`;
  messagesEl.appendChild(div);
  scrollDown();
}

function addNotice(text) {
  const div = document.createElement("div");
  div.className = "notice";
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollDown();
}

function renderRooms() {
  roomList.innerHTML = "";
  rooms.forEach((room) => {
    const li = document.createElement("li");
    li.textContent = `# ${room}`;
    if (view.type === "room" && view.room === room) li.classList.add("active");
    li.addEventListener("click", () => joinRoom(room));
    roomList.appendChild(li);
  });
}

function renderOnline() {
  onlineList.innerHTML = "";
  document.getElementById("online-count").textContent = onlineUsers.length;

  onlineUsers.forEach((user) => {
    const li = document.createElement("li");
    const isMe = me && user.id === me.id;
    li.innerHTML = `<span>${escapeHtml(user.avatar)}</span><span>${escapeHtml(user.username)}${isMe ? " (you)" : ""}</span>`;

    if (unread[user.id]) {
      li.innerHTML += `<span class="badge">${unread[user.id]}</span>`;
    } else if (user.room) {
      li.innerHTML += `<span class="where">#${escapeHtml(user.room)}</span>`;
    }
    if (view.type === "dm" && view.id === user.id) li.classList.add("active");
    if (!isMe) li.addEventListener("click", () => openDm(user.id, user.username));
    onlineList.appendChild(li);
  });
}

function renderHeader() {
  if (view.type === "room") {
    titleEl.textContent = `#${view.room}`;
    subEl.textContent = roomMembers.length ? `in room: ${roomMembers.join(", ")}` : "";
    messageInput.placeholder = `Message #${view.room}`;
  } else {
    titleEl.textContent = `DM with ${view.name}`;
    subEl.textContent = "private, only the two of you see this";
    messageInput.placeholder = `Message ${view.name}`;
  }
}

function renderTyping() {
  const names = [...typingUsers];
  if (view.type !== "room" || names.length === 0) {
    typingEl.textContent = "";
  } else if (names.length === 1) {
    typingEl.textContent = `${names[0]} is typing...`;
  } else {
    typingEl.textContent = `${names.join(", ")} are typing...`;
  }
}

function renderAll() {
  renderRooms();
  renderOnline();
  renderHeader();
  renderTyping();
}

function joinRoom(room) {
  stopTyping();
  view = { type: "room", room };
  socket.emit("room:join", { room });
}

function openDm(id, name) {
  stopTyping();
  view = { type: "dm", id, name };
  unread[id] = 0;
  typingUsers.clear();
  messagesEl.innerHTML = "";
  (dmThreads[id] || []).forEach((entry) =>
    addBubble({ sender: entry.from, message: entry.message, timestamp: entry.timestamp, mine: entry.mine, dm: true }),
  );
  if (!(dmThreads[id] || []).length) addNotice(`Start a private conversation with ${name}`);
  renderAll();
}

function pushDm(id, entry) {
  if (!dmThreads[id]) dmThreads[id] = [];
  dmThreads[id].push(entry);
}

// typing indicator: one typing:start on the first key, typing:stop once the
// user has been idle for TYPING_IDLE_MS (debounced) or sends the message
function stopTyping() {
  clearTimeout(typingTimer);
  if (isTyping && currentRoom) socket.emit("typing:stop", { room: currentRoom });
  isTyping = false;
}

messageInput.addEventListener("input", () => {
  if (view.type !== "room" || !currentRoom) return;
  if (!isTyping) {
    isTyping = true;
    socket.emit("typing:start", { room: currentRoom });
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, TYPING_IDLE_MS);
});

document.getElementById("send-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) return;

  if (view.type === "room") {
    stopTyping();
    socket.emit("chat:send", { room: view.room, message });
  } else {
    socket.emit("direct:send", { recipientId: view.id, message });
  }
  messageInput.value = "";
});

document.getElementById("new-room-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.getElementById("new-room");
  const room = input.value.trim();
  if (room) joinRoom(room);
  input.value = "";
});

document.getElementById("leave-btn").addEventListener("click", () => {
  if (view.type === "dm") return joinRoom(currentRoom || "general");
  stopTyping();
  socket.emit("room:leave");
});

// ---- login ----
const avatarsEl = document.getElementById("avatars");
AVATARS.forEach((face, index) => {
  const span = document.createElement("span");
  span.textContent = face;
  if (index === 0) span.classList.add("picked");
  span.addEventListener("click", () => {
    avatarsEl.querySelectorAll("span").forEach((node) => node.classList.remove("picked"));
    span.classList.add("picked");
    avatar = face;
  });
  avatarsEl.appendChild(span);
});

document.getElementById("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const username = document.getElementById("username").value.trim();
  if (username) socket.emit("user:login", { username, avatar });
});

// ---- socket events ----
socket.on("connect", () => {
  statusEl.textContent = "online";
  statusEl.className = "status online";
  // server state is in memory; after a reconnect log back in and rejoin
  if (me) {
    currentRoom = null;
    socket.emit("user:login", { username: me.username, avatar: me.avatar });
  }
});

socket.on("disconnect", () => {
  statusEl.textContent = "offline";
  statusEl.className = "status offline";
});

socket.on("user:ready", ({ id, username, rooms: list }) => {
  me = { id, username, avatar };
  rooms = list;
  loginEl.classList.add("hidden");
  appEl.classList.remove("hidden");
  document.getElementById("me-avatar").textContent = avatar;
  document.getElementById("me-name").textContent = username;
  joinRoom(lastRoom);
  messageInput.focus();
});

socket.on("chat:error", ({ message }) => toast("error", message));

socket.on("rooms:list", ({ rooms: list }) => {
  rooms = list;
  renderRooms();
});

socket.on("users:online", ({ users }) => {
  onlineUsers = users;
  renderOnline();
});

socket.on("room:history", ({ room, messages }) => {
  currentRoom = room;
  lastRoom = room;
  view = { type: "room", room };
  if (!rooms.includes(room)) rooms.push(room);
  typingUsers.clear();
  messagesEl.innerHTML = "";
  if (messages.length) addNotice(`last ${messages.length} message(s) in #${room}`);
  messages.forEach((msg) => addBubble({ ...msg, mine: me && msg.sender === me.username }));
  addNotice(`you joined #${room}`);
  renderAll();
});

socket.on("room:left", () => {
  currentRoom = null;
  roomMembers = [];
  typingUsers.clear();
  messagesEl.innerHTML = "";
  addNotice("You left the room. Pick one from the sidebar.");
  titleEl.textContent = "No room";
  subEl.textContent = "";
  roomList.querySelectorAll("li").forEach((li) => li.classList.remove("active"));
  renderTyping();
});

socket.on("room:userlist", ({ room, users }) => {
  if (room !== currentRoom) return;
  roomMembers = users;
  if (view.type === "room") renderHeader();
});

socket.on("room:notice", ({ room, text }) => {
  if (view.type === "room" && room === currentRoom) addNotice(text);
});

socket.on("chat:receive", (msg) => {
  if (msg.room !== currentRoom) return;
  typingUsers.delete(msg.sender);
  renderTyping();
  if (view.type === "room") {
    addBubble({ ...msg, mine: me && msg.sender === me.username });
  }
});

socket.on("typing:update", ({ username, isTyping: typing }) => {
  if (typing) typingUsers.add(username);
  else typingUsers.delete(username);
  renderTyping();
});

socket.on("direct:receive", ({ fromId, from, message, timestamp }) => {
  pushDm(fromId, { from, message, timestamp, mine: false });
  if (view.type === "dm" && view.id === fromId) {
    addBubble({ sender: from, message, timestamp, mine: false, dm: true });
  } else {
    unread[fromId] = (unread[fromId] || 0) + 1;
    renderOnline();
    toast("info", `DM from ${from}: ${message.slice(0, 40)}`);
  }
});

socket.on("direct:sent", ({ toId, message, timestamp }) => {
  pushDm(toId, { from: me.username, message, timestamp, mine: true });
  if (view.type === "dm" && view.id === toId) {
    addBubble({ sender: me.username, message, timestamp, mine: true, dm: true });
  }
});
