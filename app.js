const storageKey = "secretchat-user";

const welcomePanel = document.querySelector("#welcomePanel");
const chatApp = document.querySelector("#chatApp");
const nameForm = document.querySelector("#nameForm");
const displayName = document.querySelector("#displayName");
const roomGate = document.querySelector("#roomGate");
const createTab = document.querySelector("#createTab");
const joinTab = document.querySelector("#joinTab");
const createRoomForm = document.querySelector("#createRoomForm");
const joinRoomForm = document.querySelector("#joinRoomForm");
const roomName = document.querySelector("#roomName");
const roomCode = document.querySelector("#roomCode");
const joinError = document.querySelector("#joinError");
const profileName = document.querySelector("#profileName");
const profileAvatar = document.querySelector("#profileAvatar");
const onlineStatus = document.querySelector("#onlineStatus");
const activeRoomName = document.querySelector("#activeRoomName");
const conversationTitle = document.querySelector("#conversationTitle");
const mobileConversationTitle = document.querySelector("#mobileConversationTitle");
const mobileProfileAvatar = document.querySelector("#mobileProfileAvatar");
const roomMeta = document.querySelector("#roomMeta");
const secretCodeLabel = document.querySelector("#secretCodeLabel");
const mobileSecretCodeLabel = document.querySelector("#mobileSecretCodeLabel");
const copyCode = document.querySelector("#copyCode");
const mobileCopyCode = document.querySelector("#mobileCopyCode");
const shareRoomCode = document.querySelector("#shareRoomCode");
const messages = document.querySelector("#messages");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const imageInput = document.querySelector("#imageInput");
const imagePreview = document.querySelector("#imagePreview");
const imagePreviewThumb = document.querySelector("#imagePreviewThumb");
const imageName = document.querySelector("#imageName");
const shareImage = document.querySelector("#shareImage");
const removeImage = document.querySelector("#removeImage");
const replyPreview = document.querySelector("#replyPreview");
const replyAuthor = document.querySelector("#replyAuthor");
const replyText = document.querySelector("#replyText");
const cancelReply = document.querySelector("#cancelReply");
const typingIndicator = document.querySelector("#typingIndicator");
const participantsPopover = document.querySelector("#participantsPopover");
const participantsList = document.querySelector("#participantsList");
const appBasePath = window.location.pathname === "/secretchat" || window.location.pathname.startsWith("/secretchat/") ? "/secretchat" : "";
const apiUrl = (path) => `${appBasePath}${path}`;

let state = loadState();
let currentRoom = null;
let events = null;
let selectedReply = null;
let visibleAfter = null;
let pressTimer = null;
const typingClientId = crypto.randomUUID();
let typingIdleTimer = null;
let isTyping = false;

if (state.name) {
  showRoomGate();
}

nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = displayName.value.trim();

  if (!name) {
    displayName.focus();
    return;
  }

  state.name = name;
  saveState();
  showRoomGate();
});

createTab.addEventListener("click", () => {
  showRoomMode("create");
});

joinTab.addEventListener("click", () => {
  showRoomMode("join");
});

createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = roomName.value.trim();

  if (!name) {
    roomName.focus();
    return;
  }

  const result = await requestJson(apiUrl("/api/rooms"), {
    method: "POST",
    body: {
      name,
      userName: state.name
    }
  });

  if (result.ok) {
    enterChat(result.room);
  }
});

joinRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = normalizeCode(roomCode.value);

  if (!code) {
    roomCode.focus();
    return;
  }

  const result = await requestJson(apiUrl(`/api/rooms/${encodeURIComponent(code)}/join`), {
    method: "POST",
    body: {
      userName: state.name
    }
  });

  if (!result.ok) {
    joinError.textContent = result.message || "No room found with that secret code.";
    joinError.classList.remove("hidden");
    roomCode.focus();
    return;
  }

  joinError.classList.add("hidden");
  enterChat(result.room, result.joinedAt);
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendCurrentMessage();
});

messageInput.addEventListener("input", () => {
  window.clearTimeout(typingIdleTimer);
  const hasText = Boolean(messageInput.value.trim());
  setTypingStatus(hasText);
  if (hasText) {
    typingIdleTimer = window.setTimeout(() => setTypingStatus(false), 1000);
  }
});

async function sendCurrentMessage() {
  const text = messageInput.value.trim();

  if ((!text && !imageInput.files.length) || !currentRoom) {
    messageInput.focus();
    return;
  }

  const image = imageInput.files.length ? await compressSelectedImage(imageInput.files[0]) : null;

  if (imageInput.files.length && !image) {
    imagePreview.classList.remove("hidden");
    imageName.textContent = "Could not compress this image under 2 MB.";
    return;
  }

  messageInput.value = "";
  setTypingStatus(false);
  window.clearTimeout(typingIdleTimer);
  clearImageSelection();
  await requestJson(apiUrl(`/api/rooms/${encodeURIComponent(currentRoom.code)}/messages`), {
    method: "POST",
    body: {
      author: state.name,
      text,
      image,
      replyTo: selectedReply
    }
  });
  clearReply();
}

document.querySelectorAll(".leave-room").forEach((button) => {
  button.addEventListener("click", () => {
    setTypingStatus(false);
    window.clearTimeout(typingIdleTimer);
    if (events) events.close();
    events = null;
    currentRoom = null;
    visibleAfter = null;
    clearReply();
    clearImageSelection();
    chatApp.classList.add("hidden");
    welcomePanel.classList.remove("hidden");
    showRoomGate();
  });
});

document.querySelectorAll(".show-participants").forEach((button) => {
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", () => {
    const opening = participantsPopover.classList.contains("hidden");
    participantsList.replaceChildren();
    (currentRoom?.members || []).forEach((name) => {
      const person = document.createElement("li");
      person.textContent = name;
      participantsList.append(person);
    });
    participantsPopover.classList.toggle("hidden", !opening);
    document.querySelectorAll(".show-participants").forEach((title) => title.setAttribute("aria-expanded", String(opening)));
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".show-participants") && !event.target.closest("#participantsPopover")) {
    participantsPopover.classList.add("hidden");
    document.querySelectorAll(".show-participants").forEach((title) => title.setAttribute("aria-expanded", "false"));
  }
});

copyCode.addEventListener("click", async () => {
  await copyRoomCode(copyCode);
});

mobileCopyCode.addEventListener("click", async () => {
  await copyRoomCode(mobileCopyCode);
});

shareRoomCode.addEventListener("click", async () => {
  if (!currentRoom) return;

  const shareText = `Join my SecretChat room with code: ${currentRoom.code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Join my SecretChat room", text: shareText });
    } catch (error) {
      if (error.name !== "AbortError") roomMeta.textContent = "Could not share the room code.";
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(shareText);
    shareRoomCode.textContent = "Copied";
    window.setTimeout(() => { shareRoomCode.textContent = "Share"; }, 1400);
  } catch {
    roomMeta.textContent = shareText;
  }
});

imageInput.addEventListener("change", () => {
  if (!imageInput.files.length) {
    clearImageSelection();
    return;
  }

  imagePreviewThumb.src = URL.createObjectURL(imageInput.files[0]);
  imagePreview.classList.remove("hidden");
  imageName.textContent = imageInput.files[0].name;
});

shareImage.addEventListener("click", async () => {
  await sendCurrentMessage();
});

removeImage.addEventListener("click", () => {
  clearImageSelection();
  messageInput.focus();
});

cancelReply.addEventListener("click", () => {
  clearReply();
  messageInput.focus();
});

async function copyRoomCode(button) {
  if (!currentRoom) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentRoom.code);
    button.firstChild.textContent = "Copied: ";
    window.setTimeout(() => {
      button.firstChild.textContent = "Code: ";
    }, 1400);
  } catch {
    roomMeta.textContent = `Secret code: ${currentRoom.code}`;
  }
}

function showRoomGate() {
  nameForm.classList.add("hidden");
  roomGate.classList.remove("hidden");
  displayName.value = state.name;
  roomName.focus();
}

function showRoomMode(mode) {
  const isCreate = mode === "create";
  createTab.classList.toggle("active", isCreate);
  joinTab.classList.toggle("active", !isCreate);
  createRoomForm.classList.toggle("hidden", !isCreate);
  joinRoomForm.classList.toggle("hidden", isCreate);
  joinError.classList.add("hidden");

  if (isCreate) {
    roomName.focus();
  } else {
    roomCode.focus();
  }
}

function enterChat(room, joinedAt = null) {
  isTyping = false;
  currentRoom = room;
  visibleAfter = joinedAt ? Date.parse(joinedAt) : null;
  welcomePanel.classList.add("hidden");
  chatApp.classList.remove("hidden");
  profileName.textContent = state.name;
  profileAvatar.textContent = state.name.charAt(0).toUpperCase();
  onlineStatus.textContent = `${state.name} is online`;
  activeRoomName.textContent = room.name;
  conversationTitle.textContent = room.name;
  mobileConversationTitle.textContent = room.name;
  mobileProfileAvatar.textContent = state.name.charAt(0).toUpperCase();
  secretCodeLabel.textContent = room.code;
  mobileSecretCodeLabel.textContent = room.code;
  renderMessages(room.messages);
  connectToRoomEvents(room.code);
  messageInput.focus();
}

function connectToRoomEvents(code) {
  if (events) {
    events.close();
  }

  typingIndicator.classList.remove("hidden");
  typingIndicator.firstChild.textContent = "Connecting";
  events = new EventSource(apiUrl(`/api/rooms/${encodeURIComponent(code)}/events?clientId=${encodeURIComponent(typingClientId)}&userName=${encodeURIComponent(state.name)}`));

  events.addEventListener("open", () => {
    typingIndicator.classList.add("hidden");
  });

  events.addEventListener("room", (event) => {
    const nextRoom = JSON.parse(event.data);
    const priorIds = new Set((currentRoom?.messages || []).map((message) => message.id));
    currentRoom = nextRoom;
    renderMessages(currentRoom.messages);
    currentRoom.messages.forEach((message) => {
      if (!priorIds.has(message.id) && (!visibleAfter || Date.parse(message.createdAt) > visibleAfter) && isEmojiOnly(message.text)) {
        floatEmojis(message.text);
      }
    });
  });

  events.addEventListener("typing", (event) => {
    const users = JSON.parse(event.data).users.filter((user) => user.id !== typingClientId);
    typingIndicator.firstChild.textContent = users.length === 1
      ? `${users[0].name} is typing`
      : users.length > 1
        ? `${users.map((user) => user.name).join(", ")} are typing`
        : "SecretChat is typing";
    typingIndicator.classList.toggle("hidden", users.length === 0);
  });

  events.addEventListener("error", () => {
    typingIndicator.classList.remove("hidden");
    typingIndicator.firstChild.textContent = "Reconnecting";
  });
}

function setTypingStatus(typing) {
  if (!currentRoom || typing === isTyping) return;
  isTyping = typing;
  requestJson(apiUrl(`/api/rooms/${encodeURIComponent(currentRoom.code)}/typing`), {
    method: "POST",
    body: { userName: state.name, clientId: typingClientId, isTyping: typing }
  });
}

function renderMessages(roomMessages) {
  messages.replaceChildren();

  roomMessages = roomMessages.filter((message) => !visibleAfter || Date.parse(message.createdAt) > visibleAfter);

  roomMessages.forEach((message) => {
    const item = document.createElement("article");
    item.className = "message";
    item.style.setProperty("--user-color", userColor(message.author));
    item.style.setProperty("--user-soft-color", userSoftColor(message.author));

    if (message.author === state.name) {
      item.classList.add("sent");
    }

    if (message.author === "system") {
      item.classList.add("system");
      item.textContent = message.text;
      messages.append(item);
      return;
    }

    const author = document.createElement("strong");
    author.textContent = message.author;
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    item.append(author, bubble);

    if (message.replyTo) {
      const reply = document.createElement("button");
      reply.className = "reply-snippet";
      reply.type = "button";
      reply.textContent = `${message.replyTo.author}: ${message.replyTo.text}`;
      reply.addEventListener("click", () => {
        document.querySelector(`[data-message-id="${message.replyTo.id}"]`)?.scrollIntoView({
          block: "center",
          behavior: "smooth"
        });
      });
      bubble.append(reply);
    }

    if (message.text) {
      const body = document.createElement("p");
      body.textContent = message.text;
      bubble.append(body);
    }

    if (message.image) {
      const imageWrap = document.createElement("div");
      imageWrap.className = "chat-image-wrap";
      const image = document.createElement("img");
      image.className = "chat-image";
      image.src = message.image.data;
      image.alt = message.image.name || "Shared image";
      const download = document.createElement("a");
      download.className = "image-download";
      download.href = message.image.data;
      download.download = message.image.name || "shared-image.jpg";
      download.textContent = "Download";
      download.setAttribute("aria-label", `Download ${download.download}`);
      imageWrap.append(image, download);
      bubble.append(imageWrap);
    }

    const time = document.createElement("time");
    time.dateTime = message.createdAt;
    time.textContent = new Intl.DateTimeFormat([], {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(message.createdAt));

    item.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, a")) return;
      pressTimer = window.setTimeout(() => selectReply(message), 550);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
      item.addEventListener(eventName, () => window.clearTimeout(pressTimer));
    });
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      selectReply(message);
    });

    item.dataset.messageId = message.id;
    bubble.append(time);
    messages.append(item);
  });

  roomMeta.textContent = `Code ${currentRoom.code}`;
  messages.scrollTop = messages.scrollHeight;
}

function selectReply(message) {
  selectedReply = {
    id: message.id,
    author: message.author,
    text: message.text || (message.image ? "Image" : "Message")
  };
  replyAuthor.textContent = `Replying to ${selectedReply.author}`;
  replyText.textContent = selectedReply.text;
  replyPreview.classList.remove("hidden");
  messageInput.focus();
}

function isEmojiOnly(text) {
  return Boolean(text && /^[\p{Extended_Pictographic}\p{Emoji}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}\s]+$/u.test(text));
}

function floatEmojis(text) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const symbols = Array.from(segmenter.segment(text), ({ segment }) => segment)
    .filter((character) => /\p{Extended_Pictographic}/u.test(character));
  const burst = document.createElement("div");
  burst.className = "emoji-burst";
  burst.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 18; index += 1) {
    const emoji = document.createElement("span");
    emoji.textContent = symbols[index % symbols.length] || text;
    emoji.style.setProperty("--x", `${Math.random() * 90 + 5}%`);
    emoji.style.setProperty("--drift", `${Math.random() * 160 - 80}px`);
    emoji.style.setProperty("--delay", `${Math.random() * 250}ms`);
    burst.append(emoji);
  }
  messages.append(burst);
  window.setTimeout(() => burst.remove(), 3200);
}

function clearReply() {
  selectedReply = null;
  replyPreview.classList.add("hidden");
}

function clearImageSelection() {
  if (imagePreviewThumb.src) {
    URL.revokeObjectURL(imagePreviewThumb.src);
  }

  imageInput.value = "";
  imagePreviewThumb.src = "";
  imagePreview.classList.add("hidden");
  imageName.textContent = "Image selected";
}

async function compressSelectedImage(file) {
  const maxSize = 2 * 1024 * 1024;

  if (!file.type.startsWith("image/")) {
    return null;
  }

  const dataUrl = await readFileAsDataUrl(file);

  if (file.size <= maxSize) {
    return {
      name: file.name,
      type: file.type,
      data: dataUrl
    };
  }

  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));

  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
    const compressedData = canvas.toDataURL("image/jpeg", quality);

    if (dataUrlSize(compressedData) <= maxSize) {
      return {
        name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
        type: "image/jpeg",
        data: compressedData
      };
    }
  }

  const smallerCanvas = document.createElement("canvas");
  const smallerContext = smallerCanvas.getContext("2d");
  smallerCanvas.width = Math.max(1, Math.round(canvas.width * 0.65));
  smallerCanvas.height = Math.max(1, Math.round(canvas.height * 0.65));
  smallerContext.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);

  const finalData = smallerCanvas.toDataURL("image/jpeg", 0.5);
  if (dataUrlSize(finalData) <= maxSize) {
    return {
      name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
      type: "image/jpeg",
      data: finalData
    };
  }

  return null;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(reader.result);
    });
    reader.addEventListener("error", () => {
      resolve(null);
    });
    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      resolve(image);
    });
    image.addEventListener("error", reject);
    image.src = source;
  });
}

function dataUrlSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
}

async function requestJson(url, options = {}) {
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json();

    return {
      ok: response.ok,
      ...payload
    };
  } catch {
    return {
      ok: false,
      message: "Start the SecretChat server, then try again."
    };
  }
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved.name === "string") {
      return saved;
    }
  } catch {
    localStorage.removeItem(storageKey);
  }

  return {
    name: ""
  };
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function normalizeCode(code) {
  return code.trim().toUpperCase();
}

function userColor(author) {
  const hue = hashString(author) % 360;
  return `hsl(${hue} 64% 38%)`;
}

function userSoftColor(author) {
  const hue = hashString(author) % 360;
  return `hsl(${hue} 82% 94%)`;
}

function hashString(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}
