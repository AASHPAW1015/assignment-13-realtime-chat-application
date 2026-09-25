// In-memory chat history. Each room keeps only its last MAX_HISTORY messages,
// which is what a new joiner gets replayed. Everything resets on restart.
const MAX_HISTORY = 50;
const DEFAULT_ROOMS = ["general", "developers", "random", "gaming", "tech"];

const roomHistories = {};
DEFAULT_ROOMS.forEach((room) => {
  roomHistories[room] = [];
});

// "#My Room!" -> "my-room". Keeps room names safe to show and to use as keys.
function normalizeRoom(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/^#/, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 24);
}

function ensureRoom(room) {
  if (!roomHistories[room]) roomHistories[room] = [];
  return roomHistories[room];
}

function addMessageToHistory(room, messageObj) {
  const history = ensureRoom(room);
  history.push(messageObj);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function getHistory(room) {
  return roomHistories[room] ? [...roomHistories[room]] : [];
}

function listRooms() {
  return Object.keys(roomHistories);
}

module.exports = {
  MAX_HISTORY,
  normalizeRoom,
  ensureRoom,
  addMessageToHistory,
  getHistory,
  listRooms,
};
