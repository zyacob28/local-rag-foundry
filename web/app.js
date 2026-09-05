const conversation = document.querySelector("#conversation");
const welcomeCardTemplate = document.querySelector("#welcome-card").cloneNode(true);
const conversationTitle = document.querySelector("#conversation-title");
const privateModeBadge = document.querySelector("#private-mode-badge");
const chatList = document.querySelector("#chat-list");
const privateChatList = document.querySelector("#private-chat-list");
const privateChatContent = document.querySelector("#private-chat-content");
const newChatButton = document.querySelector("#new-chat-button");
const newPrivateChatButton = document.querySelector("#new-private-chat-button");
const privateAccessButton = document.querySelector("#private-access-button");
const privateAccessLabel = document.querySelector("#private-access-label");
const privateHelp = document.querySelector("#private-help");
const vaultState = document.querySelector("#vault-state");
const privateDocumentSummary = document.querySelector("#private-document-summary");
const privateDocumentList = document.querySelector("#private-document-list");
const privateDropZone = document.querySelector("#private-drop-zone");
const privateDropZoneStatus = document.querySelector("#private-drop-zone-status");
const privateDocumentInput = document.querySelector("#private-document-input");
const form = document.querySelector("#question-form");
const input = document.querySelector("#question-input");
const sendButton = document.querySelector("#send-button");
const composerNote = document.querySelector("#composer-note");
const reindexButton = document.querySelector("#reindex-button");
const dropZone = document.querySelector("#drop-zone");
const dropZoneStatus = document.querySelector("#drop-zone-status");
const documentInput = document.querySelector("#document-input");
const toast = document.querySelector("#toast");
const vaultDialog = document.querySelector("#vault-dialog");
const vaultForm = document.querySelector("#vault-form");
const vaultDialogTitle = document.querySelector("#vault-dialog-title");
const vaultDialogCopy = document.querySelector("#vault-dialog-copy");
const vaultPassword = document.querySelector("#vault-password");
const vaultPasswordConfirm = document.querySelector("#vault-password-confirm");
const vaultConfirmGroup = document.querySelector("#vault-confirm-group");
const vaultWarning = document.querySelector("#vault-warning");
const vaultError = document.querySelector("#vault-error");
const vaultSubmit = document.querySelector("#vault-submit");
const vaultDialogClose = document.querySelector("#vault-dialog-close");
const deleteChatDialog = document.querySelector("#delete-chat-dialog");
const deleteChatForm = document.querySelector("#delete-chat-form");
const deleteChatDialogCopy = document.querySelector("#delete-chat-dialog-copy");
const deleteChatCancel = document.querySelector("#delete-chat-cancel");
const deleteChatConfirm = document.querySelector("#delete-chat-confirm");

const STORAGE_KEY = "foundry-local-rag-conversations-v1";
const PRIVATE_STORAGE_KEY = "foundry-local-rag-private-vault-v1";
const MAX_SAVED_CONVERSATIONS = 20;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = [".txt", ".md", ".pdf"];
const PBKDF2_ITERATIONS = 600000;

let conversations = [];
let activeConversationId = "";
let publicSnapshot = { conversations: [], activeConversationId: "" };
let privateSnapshot = null;
let activeMode = "public";
let vaultKey = null;
let vaultSalt = null;
let vaultIterations = PBKDF2_ITERATIONS;
let vaultDialogMode = "create";
let privateSaveQueue = Promise.resolve();
let pendingChatDeletion = null;
let privateKnowledgeStatus = { document_count: 0, chunk_count: 0, documents: [] };
let requestInFlight = false;
let documentUpdateInFlight = false;
let toastTimer;

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createConversation() {
  return {
    id: makeId(),
    title: "New conversation",
    createdAt: Date.now(),
    messages: [],
  };
}

function loadConversations() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.conversations)) {
      conversations = saved.conversations.filter(
        (item) => item && typeof item.id === "string" && Array.isArray(item.messages),
      );
      activeConversationId = saved.activeConversationId;
    }
  } catch (_error) {
    conversations = [];
  }

  if (!conversations.length) {
    const firstConversation = createConversation();
    conversations = [firstConversation];
    activeConversationId = firstConversation.id;
  }

  if (!conversations.some((item) => item.id === activeConversationId)) {
    activeConversationId = conversations[0].id;
  }
  publicSnapshot = { conversations, activeConversationId };
  saveConversations();
}

function syncActiveSnapshot() {
  const snapshot = { conversations, activeConversationId };
  if (activeMode === "private") {
    privateSnapshot = { ...privateSnapshot, ...snapshot };
  } else {
    publicSnapshot = snapshot;
  }
}

function saveConversations() {
  syncActiveSnapshot();
  if (activeMode === "private") {
    return queuePrivateVaultSave();
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(publicSnapshot));
  } catch (_error) {
    // The chat still works if browser storage is unavailable.
  }
  return Promise.resolve();
}

function getActiveConversation() {
  return conversations.find((item) => item.id === activeConversationId);
}

function titleFromQuestion(question) {
  const singleLine = question.replace(/\s+/g, " ").trim();
  return singleLine.length > 42 ? `${singleLine.slice(0, 42)}…` : singleLine;
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function base64ToBytes(value) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function createPrivateKnowledgeCredentials() {
  return {
    knowledgeVaultId: makeId(),
    knowledgeAccessToken: bytesToBase64(
      window.crypto.getRandomValues(new Uint8Array(32)),
    ),
  };
}

function privateRequestHeaders(extraHeaders = {}) {
  if (!vaultKey || !privateSnapshot?.knowledgeVaultId || !privateSnapshot?.knowledgeAccessToken) {
    throw new Error("Unlock private chats to access private documents.");
  }
  return {
    ...extraHeaders,
    Authorization: `Bearer ${privateSnapshot.knowledgeAccessToken}`,
    "X-Private-Vault": privateSnapshot.knowledgeVaultId,
  };
}

async function deriveVaultKey(password, salt, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function normalizePrivateSnapshot(value) {
  if (!value || !Array.isArray(value.conversations)) {
    throw new Error("Private chat data is invalid.");
  }
  const validConversations = value.conversations.filter(
    (item) => item && typeof item.id === "string" && Array.isArray(item.messages),
  );
  const credentials =
    typeof value.knowledgeVaultId === "string" &&
    typeof value.knowledgeAccessToken === "string"
      ? {
          knowledgeVaultId: value.knowledgeVaultId,
          knowledgeAccessToken: value.knowledgeAccessToken,
        }
      : createPrivateKnowledgeCredentials();
  if (!validConversations.length) {
    const firstConversation = createConversation();
    return {
      conversations: [firstConversation],
      activeConversationId: firstConversation.id,
      ...credentials,
    };
  }
  const selectedId = validConversations.some(
    (item) => item.id === value.activeConversationId,
  )
    ? value.activeConversationId
    : validConversations[0].id;
  return {
    conversations: validConversations,
    activeConversationId: selectedId,
    ...credentials,
  };
}

async function persistPrivateVault(plaintext = JSON.stringify(privateSnapshot)) {
  if (!vaultKey || !vaultSalt) return;
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    vaultKey,
    new TextEncoder().encode(plaintext),
  );
  window.localStorage.setItem(
    PRIVATE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      iterations: vaultIterations,
      salt: bytesToBase64(vaultSalt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    }),
  );
}

function queuePrivateVaultSave() {
  if (!vaultKey || !privateSnapshot) return Promise.resolve();
  const plaintext = JSON.stringify(privateSnapshot);
  privateSaveQueue = privateSaveQueue
    .then(() => persistPrivateVault(plaintext))
    .catch(() => showToast("Private chat changes could not be encrypted.", true));
  return privateSaveQueue;
}

function activateMode(mode) {
  syncActiveSnapshot();
  const nextSnapshot = mode === "private" ? privateSnapshot : publicSnapshot;
  if (!nextSnapshot) return;
  activeMode = mode;
  conversations = nextSnapshot.conversations;
  activeConversationId = nextSnapshot.activeConversationId;
  renderChatList();
  renderConversation();
  input.focus();
}

async function createPrivateVault(password) {
  vaultSalt = window.crypto.getRandomValues(new Uint8Array(16));
  vaultIterations = PBKDF2_ITERATIONS;
  vaultKey = await deriveVaultKey(password, vaultSalt, vaultIterations);
  const firstConversation = createConversation();
  privateSnapshot = {
    conversations: [firstConversation],
    activeConversationId: firstConversation.id,
    ...createPrivateKnowledgeCredentials(),
  };
  await persistPrivateVault();
  activateMode("private");
}

async function unlockPrivateVault(password) {
  const stored = JSON.parse(window.localStorage.getItem(PRIVATE_STORAGE_KEY) || "null");
  if (!stored || !stored.salt || !stored.iv || !stored.ciphertext) {
    throw new Error("The private chat vault could not be found.");
  }
  const salt = base64ToBytes(stored.salt);
  const iterations = Number(stored.iterations) || PBKDF2_ITERATIONS;
  const key = await deriveVaultKey(password, salt, iterations);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(stored.iv) },
    key,
    base64ToBytes(stored.ciphertext),
  );
  privateSnapshot = normalizePrivateSnapshot(
    JSON.parse(new TextDecoder().decode(plaintext)),
  );
  vaultSalt = salt;
  vaultIterations = iterations;
  vaultKey = key;
  await queuePrivateVaultSave();
  activateMode("private");
}

async function lockPrivateVault() {
  if (activeMode === "private") {
    syncActiveSnapshot();
    await queuePrivateVaultSave();
    activateMode("public");
  }
  vaultKey = null;
  vaultSalt = null;
  privateSnapshot = null;
  privateKnowledgeStatus = { document_count: 0, chunk_count: 0, documents: [] };
  renderPrivateKnowledgeStatus(privateKnowledgeStatus);
  renderChatList();
  showToast("Private chats locked.");
}

function openVaultDialog() {
  vaultDialogMode = window.localStorage.getItem(PRIVATE_STORAGE_KEY) ? "unlock" : "create";
  const creating = vaultDialogMode === "create";
  vaultDialogTitle.textContent = creating ? "Create private chats" : "Unlock private chats";
  vaultDialogCopy.textContent = creating
    ? "Choose a password for encrypted private chats and a separate private knowledge base."
    : "Enter your password to open your private chats and private documents.";
  vaultConfirmGroup.hidden = !creating;
  vaultPasswordConfirm.required = creating;
  vaultPassword.autocomplete = creating ? "new-password" : "current-password";
  vaultWarning.hidden = !creating;
  vaultSubmit.textContent = creating ? "Create private space" : "Unlock private chats";
  vaultError.textContent = "";
  vaultForm.reset();
  vaultDialog.showModal();
  vaultPassword.focus();
}

async function submitVaultPassword(event) {
  event.preventDefault();
  const password = vaultPassword.value;
  if (password.length < 8) {
    vaultError.textContent = "Use a password with at least 8 characters.";
    return;
  }
  if (vaultDialogMode === "create" && password !== vaultPasswordConfirm.value) {
    vaultError.textContent = "The passwords do not match.";
    return;
  }

  vaultSubmit.disabled = true;
  vaultSubmit.textContent = vaultDialogMode === "create" ? "Encrypting…" : "Unlocking…";
  vaultError.textContent = "";
  try {
    if (vaultDialogMode === "create") {
      await createPrivateVault(password);
      showToast("Private space created and unlocked.");
    } else {
      await unlockPrivateVault(password);
      showToast("Private chats unlocked.");
    }
    vaultDialog.close();
    vaultForm.reset();
    refreshPrivateKnowledgeStatus();
  } catch (_error) {
    vaultError.textContent = "The password is incorrect or the private vault is damaged.";
  } finally {
    vaultSubmit.disabled = false;
    vaultSubmit.textContent =
      vaultDialogMode === "create" ? "Create private space" : "Unlock private chats";
  }
}

function openDeleteChatDialog(id, mode, title) {
  if (requestInFlight || (mode === "private" && !vaultKey)) return;
  pendingChatDeletion = { id, mode };
  deleteChatDialogCopy.textContent = mode === "private"
    ? `“${title}” and all of its messages will be removed from your encrypted private history.`
    : `“${title}” and all of its messages will be permanently removed from this browser.`;
  deleteChatDialog.showModal();
  deleteChatCancel.focus();
}

async function deleteSelectedChat(event) {
  event.preventDefault();
  if (!pendingChatDeletion) return;
  const { id, mode } = pendingChatDeletion;
  const snapshot = mode === "private" ? privateSnapshot : publicSnapshot;
  if (!snapshot || !snapshot.conversations.some((item) => item.id === id)) {
    deleteChatDialog.close();
    pendingChatDeletion = null;
    return;
  }

  const remaining = snapshot.conversations.filter((item) => item.id !== id);
  if (!remaining.length) remaining.push(createConversation());
  const selectedId = snapshot.activeConversationId === id
    ? remaining[0].id
    : snapshot.activeConversationId;
  const updatedSnapshot = {
    ...snapshot,
    conversations: remaining,
    activeConversationId: selectedId,
  };

  deleteChatConfirm.disabled = true;
  deleteChatConfirm.textContent = "Deleting…";
  try {
    if (mode === "private") {
      privateSnapshot = updatedSnapshot;
      if (activeMode === "private") {
        conversations = privateSnapshot.conversations;
        activeConversationId = privateSnapshot.activeConversationId;
      }
      await queuePrivateVaultSave();
    } else {
      publicSnapshot = updatedSnapshot;
      if (activeMode === "public") {
        conversations = publicSnapshot.conversations;
        activeConversationId = publicSnapshot.activeConversationId;
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(publicSnapshot));
      } catch (_error) {
        // The in-memory chat list is still updated when browser storage is unavailable.
      }
    }

    deleteChatDialog.close();
    pendingChatDeletion = null;
    renderChatList();
    renderConversation();
    showToast(mode === "private" ? "Private chat deleted." : "Chat deleted.");
    input.focus();
  } finally {
    deleteChatConfirm.disabled = false;
    deleteChatConfirm.textContent = "Delete chat";
  }
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast visible${isError ? " error" : ""}`;
  toastTimer = window.setTimeout(() => {
    toast.className = "toast";
  }, 4500);
}

async function fetchJSON(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "The request could not be completed.");
  }
  return body;
}

function fetchPrivateJSON(url, options = {}) {
  return fetchJSON(url, {
    ...options,
    headers: privateRequestHeaders(options.headers || {}),
  });
}

function renderPrivateKnowledgeStatus(status) {
  privateKnowledgeStatus = {
    document_count: Number(status?.document_count) || 0,
    chunk_count: Number(status?.chunk_count) || 0,
    documents: Array.isArray(status?.documents) ? status.documents : [],
  };
  const fileCount = privateKnowledgeStatus.document_count;
  privateDocumentSummary.textContent = `${fileCount} file${fileCount === 1 ? "" : "s"}`;
  privateDocumentSummary.title = `${privateKnowledgeStatus.chunk_count} private search chunks`;
  privateDocumentList.replaceChildren();
  if (!privateKnowledgeStatus.documents.length) {
    const item = document.createElement("li");
    item.className = "muted-list-item";
    item.textContent = "No private files yet";
    privateDocumentList.append(item);
    return;
  }
  privateKnowledgeStatus.documents.forEach((documentName) => {
    const item = document.createElement("li");
    item.textContent = documentName;
    item.title = documentName;
    privateDocumentList.append(item);
  });
}

async function refreshPrivateKnowledgeStatus() {
  if (!vaultKey || !privateSnapshot) return;
  try {
    renderPrivateKnowledgeStatus(await fetchPrivateJSON("/api/private/status"));
  } catch (error) {
    showToast(error.message, true);
  }
}

function setStatus(status) {
  const pill = document.querySelector("#status-pill");
  const text = document.querySelector("#status-text");
  const help = document.querySelector("#status-help");
  const modelsReady = status.chat_ready && status.embedding_ready;
  const ready = status.runtime_ready && (modelsReady || status.automatic_model_download);

  pill.className = `status-pill ${ready ? "online" : "problem"}`;
  text.textContent = modelsReady
    ? "Ready"
    : ready
      ? "Ready to set up"
      : "Needs attention";
  const backend = status.backend_name || "Local AI";
  help.textContent = ready
    ? `${backend} and both local models are ready.`
    : status.runtime_ready
      ? `${backend} is ready. Missing models download on first use.`
      : `${backend} is not available. Check the setup instructions.`;

  document.querySelector("#runtime-name").textContent = backend;
  document.querySelector("#active-model").textContent = status.chat_model || "Local model";
  document.querySelector("#document-count").textContent = status.document_count;
  document.querySelector("#chunk-count").textContent = status.chunk_count;

  const list = document.querySelector("#document-list");
  list.replaceChildren();
  if (!status.documents.length) {
    const item = document.createElement("li");
    item.className = "muted-list-item";
    item.textContent = "No indexed files yet";
    list.append(item);
    return;
  }

  status.documents.forEach((documentName) => {
    const item = document.createElement("li");
    item.textContent = documentName;
    item.title = documentName;
    list.append(item);
  });
}

async function refreshStatus() {
  try {
    setStatus(await fetchJSON("/api/status"));
  } catch (error) {
    showToast(error.message, true);
  }
}

function addUserMessage(question) {
  document.querySelector("#welcome-card")?.remove();
  const message = document.createElement("article");
  message.className = "message user";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = question;
  message.append(bubble);
  conversation.append(message);
}

function addLoadingMessage(mode = "public") {
  const message = document.createElement("article");
  message.className = "message assistant";
  message.id = "loading-message";
  message.innerHTML = `
    <div class="loading-bubble" aria-label="Searching documents and writing an answer">
      <span class="loading-copy">Searching ${mode === "private" ? "private" : "your"} documents</span>
      <span class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    </div>`;
  conversation.append(message);
}

function addAssistantMessage(answer, sources) {
  document.querySelector("#loading-message")?.remove();
  const message = document.createElement("article");
  message.className = "message assistant";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const label = document.createElement("div");
  label.className = "assistant-label";
  label.innerHTML = "<span>AI</span> GROUNDED ANSWER";
  const answerText = document.createElement("div");
  answerText.textContent = answer;
  bubble.append(label, answerText);

  if (sources.length) {
    const details = document.createElement("details");
    details.className = "sources";
    const summary = document.createElement("summary");
    summary.textContent = `${sources.length} retrieved source${sources.length === 1 ? "" : "s"}`;
    const grid = document.createElement("div");
    grid.className = "source-grid";

    sources.forEach((source, index) => {
      const card = document.createElement("div");
      card.className = "source-card";
      const title = document.createElement("strong");
      title.textContent = `[${index + 1}] ${source.source} · chunk ${source.chunk_number}`;
      const score = document.createElement("span");
      score.textContent = ` · similarity ${Number(source.score).toFixed(3)}`;
      card.append(title, score);
      grid.append(card);
    });

    details.append(summary, grid);
    bubble.append(details);
  }

  message.append(bubble);
  conversation.append(message);
}

function bindSuggestionButtons() {
  conversation.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => submitQuestion(button.textContent));
  });
}

function appendChatListItem(list, item, mode, selectedId) {
  const listItem = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-select-button";
  button.textContent = item.title;
  button.title = item.title;
  button.disabled = requestInFlight || documentUpdateInFlight;
  button.setAttribute(
    "aria-current",
    String(activeMode === mode && item.id === selectedId),
  );
  button.addEventListener("click", () => selectConversation(item.id, mode));
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-chat-button";
  deleteButton.disabled = requestInFlight || documentUpdateInFlight;
  deleteButton.title = `Delete ${item.title}`;
  deleteButton.setAttribute("aria-label", `Delete ${item.title}`);
  deleteButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>`;
  deleteButton.addEventListener("click", () => {
    openDeleteChatDialog(item.id, mode, item.title);
  });
  listItem.append(button, deleteButton);
  list.append(listItem);
}

function renderChatList() {
  syncActiveSnapshot();
  chatList.replaceChildren();
  publicSnapshot.conversations.forEach((item) => {
    appendChatListItem(chatList, item, "public", publicSnapshot.activeConversationId);
  });

  const vaultExists = Boolean(window.localStorage.getItem(PRIVATE_STORAGE_KEY));
  const vaultUnlocked = Boolean(vaultKey && privateSnapshot);
  vaultState.textContent = vaultUnlocked ? "Unlocked" : "Locked";
  vaultState.classList.toggle("unlocked", vaultUnlocked);
  privateAccessLabel.textContent = vaultUnlocked
    ? "Lock private chats"
    : vaultExists
      ? "Unlock private chats"
      : "Create private space";
  privateHelp.textContent = vaultUnlocked
    ? "Private chats search only the private documents below."
    : vaultExists
      ? "Enter your password to decrypt your private history."
      : "Create a password-protected space for sensitive conversations.";
  privateChatContent.hidden = !vaultUnlocked;
  privateChatList.replaceChildren();

  if (vaultUnlocked) {
    privateSnapshot.conversations.forEach((item) => {
      appendChatListItem(
        privateChatList,
        item,
        "private",
        privateSnapshot.activeConversationId,
      );
    });
  }

  privateAccessButton.disabled = requestInFlight || documentUpdateInFlight;
  newPrivateChatButton.disabled = requestInFlight || documentUpdateInFlight;
  newChatButton.disabled = requestInFlight || documentUpdateInFlight;
}

function renderConversation() {
  const active = getActiveConversation();
  if (!active) return;
  conversation.replaceChildren();
  conversationTitle.textContent = active.title;
  privateModeBadge.hidden = activeMode !== "private";
  input.placeholder = activeMode === "private"
    ? "Ask privately about your documents…"
    : "Ask about your documents…";
  composerNote.textContent = activeMode === "private"
    ? "Private history and documents are encrypted · Private files only · Enter to send"
    : "Answers use indexed files only · Enter to send · Shift + Enter for a new line";

  if (!active.messages.length) {
    const welcomeCard = welcomeCardTemplate.cloneNode(true);
    if (activeMode === "private") {
      welcomeCard.querySelector(".eyebrow").textContent = "PRIVATE CHAT READY";
      welcomeCard.querySelector("h3").textContent = "Your encrypted private chat is ready";
      welcomeCard.querySelector(".welcome-card > p:not(.eyebrow)").textContent =
        "Add documents inside the unlocked Private chats section, then ask questions. " +
        "Regular chats cannot list or search these files.";
      welcomeCard.querySelector(".workflow strong").textContent = "Add private files";
    }
    conversation.append(welcomeCard);
    bindSuggestionButtons();
    return;
  }

  active.messages.forEach((message) => {
    if (message.role === "user") {
      addUserMessage(message.text);
    } else {
      addAssistantMessage(message.text, message.sources || []);
    }
  });
  scrollToLatest();
}

function selectConversation(id, mode = "public") {
  if (requestInFlight || documentUpdateInFlight || (mode === "private" && !vaultKey)) return;
  syncActiveSnapshot();
  const snapshot = mode === "private" ? privateSnapshot : publicSnapshot;
  if (!snapshot || !snapshot.conversations.some((item) => item.id === id)) return;
  if (activeMode === mode && id === activeConversationId) return;

  activeMode = mode;
  conversations = snapshot.conversations;
  activeConversationId = id;
  saveConversations();
  renderChatList();
  renderConversation();
  input.focus();
}

function startNewConversation() {
  if (requestInFlight || documentUpdateInFlight) return;
  if (activeMode !== "public") activateMode("public");
  const active = getActiveConversation();
  if (!active.messages.length) {
    input.value = "";
    resizeInput();
    input.focus();
    showToast("You are already in a new standard chat.");
    return;
  }

  const nextConversation = createConversation();
  conversations.unshift(nextConversation);
  conversations = conversations.slice(0, MAX_SAVED_CONVERSATIONS);
  activeConversationId = nextConversation.id;
  saveConversations();
  renderChatList();
  renderConversation();
  input.value = "";
  resizeInput();
  input.focus();
  showToast("New standard chat started.");
}

function startNewPrivateConversation() {
  if (requestInFlight || documentUpdateInFlight) return;
  if (!vaultKey || !privateSnapshot) {
    openVaultDialog();
    return;
  }
  if (activeMode !== "private") activateMode("private");
  const active = getActiveConversation();
  if (!active.messages.length) {
    input.value = "";
    resizeInput();
    input.focus();
    showToast("You are already in a new private chat.");
    return;
  }

  const nextConversation = createConversation();
  conversations.unshift(nextConversation);
  conversations = conversations.slice(0, MAX_SAVED_CONVERSATIONS);
  activeConversationId = nextConversation.id;
  saveConversations();
  renderChatList();
  renderConversation();
  input.value = "";
  resizeInput();
  input.focus();
  showToast("New encrypted private chat started.");
}

function scrollToLatest() {
  conversation.scrollTop = conversation.scrollHeight;
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
}

function setDocumentUpdateBusy(isBusy, label = "Drop documents here") {
  documentUpdateInFlight = isBusy;
  documentInput.disabled = isBusy;
  privateDocumentInput.disabled = isBusy;
  reindexButton.disabled = isBusy;
  sendButton.disabled = isBusy || requestInFlight;
  dropZone.classList.toggle("busy", isBusy);
  dropZoneStatus.textContent = label;
  renderChatList();
}

function setPrivateDocumentUpdateBusy(isBusy, label = "Add private documents") {
  documentUpdateInFlight = isBusy;
  documentInput.disabled = isBusy;
  privateDocumentInput.disabled = isBusy;
  reindexButton.disabled = isBusy;
  sendButton.disabled = isBusy || requestInFlight;
  privateDropZone.classList.toggle("busy", isBusy);
  privateDropZoneStatus.textContent = label;
  renderChatList();
}

function fileExtension(filename) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

async function uploadDocuments(fileList) {
  if (requestInFlight || documentUpdateInFlight) return;
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const unsupported = files.find(
    (file) => !ALLOWED_UPLOAD_EXTENSIONS.includes(fileExtension(file.name)),
  );
  if (unsupported) {
    showToast(`${unsupported.name} is not supported. Use TXT, MD, or PDF.`, true);
    return;
  }
  const oversized = files.find((file) => file.size > MAX_UPLOAD_BYTES);
  if (oversized) {
    showToast(`${oversized.name} is larger than 10 MB.`, true);
    return;
  }

  setDocumentUpdateBusy(true, `Uploading 1 of ${files.length}…`);
  try {
    for (const [index, file] of files.entries()) {
      dropZoneStatus.textContent = `Uploading ${index + 1} of ${files.length}…`;
      await fetchJSON(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
    }

    dropZoneStatus.textContent = "Building search index…";
    const result = await fetchJSON("/api/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    setStatus(result.status);
    showToast(`${files.length} document${files.length === 1 ? "" : "s"} added and indexed.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    documentInput.value = "";
    setDocumentUpdateBusy(false);
  }
}

async function uploadPrivateDocuments(fileList) {
  if (requestInFlight || documentUpdateInFlight) return;
  if (!vaultKey || !privateSnapshot) {
    showToast("Unlock private chats before adding private documents.", true);
    return;
  }
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const unsupported = files.find(
    (file) => !ALLOWED_UPLOAD_EXTENSIONS.includes(fileExtension(file.name)),
  );
  if (unsupported) {
    showToast(`${unsupported.name} is not supported. Use TXT, MD, or PDF.`, true);
    return;
  }
  const oversized = files.find((file) => file.size > MAX_UPLOAD_BYTES);
  if (oversized) {
    showToast(`${oversized.name} is larger than 10 MB.`, true);
    return;
  }

  setPrivateDocumentUpdateBusy(true, `Uploading 1 of ${files.length}…`);
  try {
    for (const [index, file] of files.entries()) {
      privateDropZoneStatus.textContent = `Uploading ${index + 1} of ${files.length}…`;
      await fetchPrivateJSON(
        `/api/private/upload?filename=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        },
      );
    }

    privateDropZoneStatus.textContent = "Building private index…";
    const result = await fetchPrivateJSON("/api/private/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    renderPrivateKnowledgeStatus(result.status);
    showToast(
      `${files.length} private document${files.length === 1 ? "" : "s"} added and indexed.`,
    );
  } catch (error) {
    showToast(error.message, true);
  } finally {
    privateDocumentInput.value = "";
    setPrivateDocumentUpdateBusy(false);
  }
}

async function submitQuestion(question) {
  const cleaned = question.trim();
  if (!cleaned || requestInFlight || documentUpdateInFlight) return;

  const active = getActiveConversation();
  const targetMode = activeMode;
  const targetConversationId = active.id;
  if (!active.messages.length) {
    active.title = titleFromQuestion(cleaned);
    conversationTitle.textContent = active.title;
  }
  active.messages.push({ role: "user", text: cleaned });
  saveConversations();
  renderChatList();

  addUserMessage(cleaned);
  addLoadingMessage(targetMode);
  input.value = "";
  resizeInput();
  requestInFlight = true;
  conversation.setAttribute("aria-busy", "true");
  input.disabled = true;
  documentInput.disabled = true;
  privateDocumentInput.disabled = true;
  reindexButton.disabled = true;
  sendButton.disabled = true;
  renderChatList();
  scrollToLatest();

  try {
    const requestOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: cleaned }),
    };
    const result = targetMode === "private"
      ? await fetchPrivateJSON("/api/private/ask", requestOptions)
      : await fetchJSON("/api/ask", requestOptions);
    const target = conversations.find((item) => item.id === targetConversationId);
    const savedSources = (result.sources || []).map((source) => ({
      source: source.source,
      chunk_number: source.chunk_number,
      score: source.score,
    }));
    target?.messages.push({ role: "assistant", text: result.answer, sources: savedSources });
    saveConversations();
    addAssistantMessage(result.answer, result.sources || []);
  } catch (error) {
    document.querySelector("#loading-message")?.remove();
    const errorMessage = `I couldn't complete that request. ${error.message}`;
    const target = conversations.find((item) => item.id === targetConversationId);
    target?.messages.push({ role: "assistant", text: errorMessage, sources: [] });
    saveConversations();
    addAssistantMessage(errorMessage, []);
    showToast(error.message, true);
  } finally {
    requestInFlight = false;
    conversation.removeAttribute("aria-busy");
    input.disabled = false;
    documentInput.disabled = false;
    privateDocumentInput.disabled = false;
    reindexButton.disabled = false;
    sendButton.disabled = false;
    renderChatList();
    input.focus();
    scrollToLatest();
  }
}

newChatButton.addEventListener("click", startNewConversation);
newPrivateChatButton.addEventListener("click", startNewPrivateConversation);

privateAccessButton.addEventListener("click", () => {
  if (vaultKey) {
    lockPrivateVault();
  } else {
    openVaultDialog();
  }
});

vaultForm.addEventListener("submit", submitVaultPassword);
vaultDialogClose.addEventListener("click", () => {
  vaultDialog.close();
  vaultForm.reset();
  vaultError.textContent = "";
});
vaultDialog.addEventListener("cancel", () => {
  vaultForm.reset();
  vaultError.textContent = "";
});

deleteChatForm.addEventListener("submit", deleteSelectedChat);
deleteChatCancel.addEventListener("click", () => {
  pendingChatDeletion = null;
  deleteChatDialog.close();
});
deleteChatDialog.addEventListener("cancel", () => {
  pendingChatDeletion = null;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitQuestion(input.value);
});

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

documentInput.addEventListener("change", () => uploadDocuments(documentInput.files));
privateDocumentInput.addEventListener("change", () => {
  uploadPrivateDocuments(privateDocumentInput.files);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!documentUpdateInFlight) dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  uploadDocuments(event.dataTransfer.files);
});

["dragenter", "dragover"].forEach((eventName) => {
  privateDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!documentUpdateInFlight) privateDropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  privateDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    privateDropZone.classList.remove("dragging");
  });
});

privateDropZone.addEventListener("drop", (event) => {
  uploadPrivateDocuments(event.dataTransfer.files);
});

reindexButton.addEventListener("click", async () => {
  if (reindexButton.disabled || requestInFlight || documentUpdateInFlight) return;
  setDocumentUpdateBusy(true, "Building search index…");
  reindexButton.classList.add("busy");
  const originalText = reindexButton.lastChild.textContent;
  reindexButton.lastChild.textContent = " Updating…";
  try {
    const result = await fetchJSON("/api/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    setStatus(result.status);
    showToast(result.message);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    reindexButton.classList.remove("busy");
    reindexButton.lastChild.textContent = originalText;
    setDocumentUpdateBusy(false);
  }
});

loadConversations();
renderPrivateKnowledgeStatus(privateKnowledgeStatus);
renderChatList();
renderConversation();
refreshStatus();
input.focus();
