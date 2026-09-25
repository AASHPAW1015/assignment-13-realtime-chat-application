const { normalizeRoom, ensureRoom, getHistory, listRooms } = require("../utils/messageStore");

// usernames of everyone currently sitting in a room
function roomUsers(io, connectedUsers, room) {
  const ids = io.sockets.adapter.rooms.get(room) || new Set();
  return [...ids]
    .map((id) => connectedUsers.get(id))
    .filter(Boolean)
    .map((user) => user.username);
}

function broadcastUserList(io, connectedUsers, room) {
  io.to(room).emit("room:userlist", { room, users: roomUsers(io, connectedUsers, room) });
}

// everyone online, so the client can show who to DM (by socket id)
function broadcastOnline(io, connectedUsers) {
  const users = [...connectedUsers.entries()].map(([id, user]) => ({
    id,
    username: user.username,
    avatar: user.avatar,
    room: user.currentRoom,
  }));
  io.emit("users:online", { users });
}

function leaveCurrentRoom(io, socket, connectedUsers, stopTyping) {
  const user = connectedUsers.get(socket.id);
  if (!user || !user.currentRoom) return;

  const room = user.currentRoom;
  stopTyping(room);
  socket.leave(room);
  user.currentRoom = null;
  socket.to(room).emit("room:notice", { room, text: `${user.username} left #${room}` });
  broadcastUserList(io, connectedUsers, room);
}

function registerUserHandlers(io, socket, connectedUsers, stopTyping) {
  socket.on("user:login", ({ username, avatar } = {}) => {
    const name = String(username ?? "").trim().slice(0, 20);
    if (!name) {
      return socket.emit("chat:error", { message: "Username is required" });
    }

    const taken = [...connectedUsers.values()].some(
      (user) => user.username.toLowerCase() === name.toLowerCase(),
    );
    if (taken && !connectedUsers.has(socket.id)) {
      return socket.emit("chat:error", { message: `"${name}" is already online, pick another name` });
    }

    connectedUsers.set(socket.id, { username: name, avatar: avatar || "🙂", currentRoom: null });
    socket.emit("user:ready", { id: socket.id, username: name, rooms: listRooms() });
    broadcastOnline(io, connectedUsers);
  });

  socket.on("room:join", ({ room } = {}) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return socket.emit("chat:error", { message: "Log in first" });

    const name = normalizeRoom(room);
    if (!name) return socket.emit("chat:error", { message: "Invalid room name" });
    // already inside (e.g. coming back from a DM view): just replay history
    if (user.currentRoom === name) {
      return socket.emit("room:history", { room: name, messages: getHistory(name) });
    }

    // one room at a time, like the currentRoom field in the state map
    leaveCurrentRoom(io, socket, connectedUsers, stopTyping);

    const isNew = !listRooms().includes(name);
    ensureRoom(name);
    socket.join(name);
    user.currentRoom = name;

    // hydrate the joiner with the buffered history first, then tell the room
    socket.emit("room:history", { room: name, messages: getHistory(name) });
    socket.to(name).emit("room:notice", { room: name, text: `${user.username} joined #${name}` });
    broadcastUserList(io, connectedUsers, name);
    broadcastOnline(io, connectedUsers);
    if (isNew) io.emit("rooms:list", { rooms: listRooms() });
  });

  socket.on("room:leave", () => {
    leaveCurrentRoom(io, socket, connectedUsers, stopTyping);
    socket.emit("room:left");
    broadcastOnline(io, connectedUsers);
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(io, socket, connectedUsers, stopTyping);
    connectedUsers.delete(socket.id);
    broadcastOnline(io, connectedUsers);
  });
}

module.exports = registerUserHandlers;
